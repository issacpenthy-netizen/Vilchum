import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { rules } from "@/config";
import { estimate } from "@/lib/money";
import { publicReceipt } from "@/lib/ledger";
import { estimatePhoto, EstimatorUnavailableError, type Estimate } from "@/lib/estimator";
const formSchema = z.object({ image: z.instanceof(File).refine((file) => file.size > 0 && file.size <= 12 * 1024 * 1024, "Choose an image under 12 MB.").refine((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type), "Use a JPEG, PNG or WebP photo."), replaces: z.string().min(1).max(40).optional() });
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to view activity." }, { status: 401 });
  const [scans, payouts] = await Promise.all([
    db.scan.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, cans: true, bottles: true, estimatedPoints: true, verifiedCans: true, verifiedBottles: true, verifiedPoints: true, status: true, reason: true, createdAt: true } }),
    db.payout.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, amount: true, method: true, status: true, createdAt: true } }),
  ]);
  const refIds = [...scans.map((scan) => scan.id), ...payouts.map((payout) => payout.id)];
  const receipts = refIds.length ? await db.receipt.findMany({ where: { userId: user.id, refId: { in: refIds } }, orderBy: { createdAt: "asc" } }) : [];
  const receiptsFor = (refId: string) => receipts.filter((receipt) => receipt.refId === refId).map(publicReceipt);
  return NextResponse.json({ activity: [
    ...scans.map((scan) => ({ ...scan, kind: "SCAN" as const, receipts: receiptsFor(scan.id) })),
    ...payouts.map((payout) => ({ ...payout, kind: "CASHOUT" as const, receipts: receiptsFor(payout.id) })),
  ].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()).slice(0, 10) });
}
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to scan items." }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const parsed = formSchema.safeParse({ image: form?.get("image"), replaces: form?.get("replaces") ?? undefined });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a photo and try again." }, { status: 400 });
  const replaces = parsed.data.replaces;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (await db.scan.count({ where: { userId: user.id, createdAt: { gte: today } } }) >= rules.maxScansPerDay) return NextResponse.json({ error: "You’ve reached today’s 10 photo limit. Please try again tomorrow." }, { status: 429 });
  const input = Buffer.from(await parsed.data.image.arrayBuffer());
  let normalized: Buffer;
  // The browser already compresses captures; normalize once here for consistent
  // orientation, dimensions and JPEG MIME before hashing and sending to the estimator.
  try { normalized = await sharp(input).rotate().resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 76 }).toBuffer(); }
  catch { return NextResponse.json({ error: "We couldn’t open that photo. Choose a clear JPEG, PNG or WebP image." }, { status: 400 }); }
  const hashPixels = await sharp(normalized).resize(9, 8, { fit: "fill" }).greyscale().raw().toBuffer();
  let hash = "";
  for (let i = 0; i < 64; i++) if (hashPixels[i]! > hashPixels[i + 1]!) hash += "1"; else hash += "0";
  const priorHashes = await db.scan.findMany({ where: replaces ? { id: { not: replaces } } : undefined, select: { imageHash: true } });
  const distance = (left: string, right: string) => left.split("").reduce((sum, bit, index) => sum + (bit !== right[index] ? 1 : 0), 0);
  if (priorHashes.some((prior) => prior.imageHash.length === 64 && distance(prior.imageHash, hash) <= 5)) return NextResponse.json({ error: "This photo looks too similar to one you already submitted. Take a new photo of your items." }, { status: 409 });
  let checked: Estimate;
  try { checked = await estimatePhoto(normalized); }
  catch (error) {
    // The GPU PC is a gaming PC: it will be off sometimes. Keep the user's photo and ask them to retry.
    if (error instanceof EstimatorUnavailableError) return NextResponse.json({ error: "Photo checking is busy right now. Your photo is safe. Try again in a minute.", code: "ESTIMATOR_UNAVAILABLE" }, { status: 503, headers: { "Retry-After": "30" } });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Photo verification failed. Try a clearer photo." }, { status: 422 });
  }
  if (checked.cans + checked.bottles < 1) return NextResponse.json({ error: checked.blurry ? "Your photo is too blurry to count. Hold the phone steady and retake it." : checked.glassBottles > 0 ? "Glass bottles aren’t accepted. Photograph aluminium cans and plastic bottles." : "No cans or plastic bottles were found. Try another photo." }, { status: 422 });
  // Phase 1 only: the photo gives an unrounded estimate. It is stored on the scan and never
  // written to the ledger; a driver's count at pickup is what credits the balance.
  // A low-confidence estimate is still saved (it is never spendable) and flagged for the user and driver.
  const estimated = estimate(checked.cans, checked.bottles);
  const dir = path.join(process.cwd(), "uploads"); await mkdir(dir, { recursive: true });
  const imagePath = path.join(dir, `${randomUUID()}.jpg`);
  await writeFile(imagePath, normalized);
  try {
    const scan = await db.$transaction(async (tx) => {
      if (await tx.scan.count({ where: { userId: user.id, createdAt: { gte: today } } }) >= rules.maxScansPerDay) throw new Error("DAILY_LIMIT");
      const hashes = await tx.scan.findMany({ where: replaces ? { id: { not: replaces } } : undefined, select: { imageHash: true } });
      if (hashes.some((prior) => prior.imageHash.length === 64 && distance(prior.imageHash, hash) <= 5)) throw new Error("DUPLICATE_PHOTO");
      // A retake replaces the user's own earlier estimate, so one pile never has two open estimates.
      if (replaces) await tx.scan.updateMany({ where: { id: replaces, userId: user.id, status: "ESTIMATED" }, data: { status: "REJECTED", reason: "Replaced by a new photo." } });
      const record = await tx.scan.create({ data: { userId: user.id, imagePath, imageHash: hash, cans: checked.cans, bottles: checked.bottles, confidence: checked.confidence, lowConfidence: checked.lowConfidence, estimator: checked.source, estimatedPoints: estimated.points, status: "ESTIMATED" } });
      return record;
    });
    return NextResponse.json({ scan: { id: scan.id, cans: scan.cans, bottles: scan.bottles, estimatedPoints: scan.estimatedPoints, kg: estimated.kg, status: scan.status, lowConfidence: scan.lowConfidence, blurry: checked.blurry, glassBottles: checked.glassBottles }, verifier: checked.source });
  } catch (error) {
    await unlink(imagePath).catch(() => {});
    if (error instanceof Error && error.message === "DAILY_LIMIT") return NextResponse.json({ error: "You’ve reached today’s 10 photo limit. Please try again tomorrow." }, { status: 429 });
    if (error instanceof Error && error.message === "DUPLICATE_PHOTO") return NextResponse.json({ error: "This photo looks too similar to one you already submitted. Take a new photo of your items." }, { status: 409 });
    return NextResponse.json({ error: "We couldn’t save this scan. Please submit the photo again." }, { status: 500 });
  }
}

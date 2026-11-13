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
import { verifyImage } from "@/lib/verify-image";
const formSchema = z.object({ image: z.instanceof(File).refine((file) => file.size > 0 && file.size <= 12 * 1024 * 1024, "Choose an image under 12 MB.").refine((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type), "Use a JPEG, PNG or WebP photo.") });
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
  const parsed = formSchema.safeParse({ image: form?.get("image") });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a photo and try again." }, { status: 400 });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (await db.scan.count({ where: { userId: user.id, createdAt: { gte: today } } }) >= rules.maxScansPerDay) return NextResponse.json({ error: "You’ve reached today’s 10 photo limit. Please try again tomorrow." }, { status: 429 });
  const input = Buffer.from(await parsed.data.image.arrayBuffer());
  let normalized: Buffer;
  // The browser already compresses captures; normalize once here for consistent
  // orientation, dimensions and JPEG MIME before hashing and sending to Gemini.
  try { normalized = await sharp(input).rotate().resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 76 }).toBuffer(); }
  catch { return NextResponse.json({ error: "We couldn’t open that photo. Choose a clear JPEG, PNG or WebP image." }, { status: 400 }); }
  const hashPixels = await sharp(normalized).resize(9, 8, { fit: "fill" }).greyscale().raw().toBuffer();
  let hash = "";
  for (let i = 0; i < 64; i++) if (hashPixels[i]! > hashPixels[i + 1]!) hash += "1"; else hash += "0";
  const priorHashes = await db.scan.findMany({ select: { imageHash: true } });
  const distance = (left: string, right: string) => left.split("").reduce((sum, bit, index) => sum + (bit !== right[index] ? 1 : 0), 0);
  if (priorHashes.some((prior) => prior.imageHash.length === 64 && distance(prior.imageHash, hash) <= 5)) return NextResponse.json({ error: "This photo looks too similar to one you already submitted. Take a new photo of your items." }, { status: 409 });
  let checked;
  try { checked = await verifyImage(normalized, "image/jpeg"); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Photo verification failed. Try a clearer photo." }, { status: 422 }); }
  if (checked.result.confidence < rules.confidenceThreshold) return NextResponse.json({ error: "We couldn’t confidently verify this photo. Retake it with the items clearly visible." }, { status: 422 });
  if (checked.result.cans + checked.result.bottles < 1) return NextResponse.json({ error: checked.result.issues[0] ?? "No cans or water bottles were found. Try another photo." }, { status: 422 });
  // Phase 1 only: the photo gives an unrounded estimate. It is stored on the scan and never
  // written to the ledger; a driver's count at pickup is what credits the balance.
  const estimated = estimate(checked.result.cans, checked.result.bottles);
  const dir = path.join(process.cwd(), "uploads"); await mkdir(dir, { recursive: true });
  const imagePath = path.join(dir, `${randomUUID()}.jpg`);
  await writeFile(imagePath, normalized);
  try {
    const scan = await db.$transaction(async (tx) => {
      if (await tx.scan.count({ where: { userId: user.id, createdAt: { gte: today } } }) >= rules.maxScansPerDay) throw new Error("DAILY_LIMIT");
      const hashes = await tx.scan.findMany({ select: { imageHash: true } });
      if (hashes.some((prior) => prior.imageHash.length === 64 && distance(prior.imageHash, hash) <= 5)) throw new Error("DUPLICATE_PHOTO");
      const record = await tx.scan.create({ data: { userId: user.id, imagePath, imageHash: hash, cans: checked.result.cans, bottles: checked.result.bottles, confidence: checked.result.confidence, estimatedPoints: estimated.points, status: "ESTIMATED" } });
      return record;
    });
    return NextResponse.json({ scan: { id: scan.id, cans: scan.cans, bottles: scan.bottles, estimatedPoints: scan.estimatedPoints, kg: estimated.kg, status: scan.status }, verifier: checked.mode });
  } catch (error) {
    await unlink(imagePath).catch(() => {});
    if (error instanceof Error && error.message === "DAILY_LIMIT") return NextResponse.json({ error: "You’ve reached today’s 10 photo limit. Please try again tomorrow." }, { status: 429 });
    if (error instanceof Error && error.message === "DUPLICATE_PHOTO") return NextResponse.json({ error: "This photo looks too similar to one you already submitted. Take a new photo of your items." }, { status: 409 });
    return NextResponse.json({ error: "We couldn’t save this scan. Please submit the photo again." }, { status: 500 });
  }
}

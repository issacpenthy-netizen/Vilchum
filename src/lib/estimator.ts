// Phase 1 (estimate) of two-phase crediting: count cans and bottles in a photo.
// Server-only. The YOLO service's API key never reaches the browser.
//
// Provider: the YOLO service on the GPU PC when ESTIMATOR_URL is set, otherwise the existing
// Gemini (or development MOCK) checker. Both return the same shape.
import { z } from "zod";
import { verifyImage } from "@/lib/verify-image";
import { rules } from "@/config";

export type Estimate = {
  cans: number;
  bottles: number;
  /** Lowest per-item confidence (YOLO) or overall confidence (Gemini), 0..1. */
  confidence: number;
  /** True when the estimator is unsure: the UI shows the low-confidence chip. */
  lowConfidence: boolean;
  /** The photo itself is too blurry to trust (a reason for lowConfidence). */
  blurry: boolean;
  /** Glass bottles seen but not accepted. */
  glassBottles: number;
  source: "YOLO" | "GEMINI" | "MOCK";
};

/** The estimator is down, asleep, overloaded or misconfigured. Users should retry later. */
export class EstimatorUnavailableError extends Error {
  constructor(readonly reason: string) { super("ESTIMATOR_UNAVAILABLE"); }
}
/** The photo itself was rejected (corrupt, too small, too large). Users should retake it. */
export class PhotoRejectedError extends Error {}

const detectSchema = z.object({
  status: z.enum(["success", "low_confidence"]),
  items: z.array(z.object({ label: z.enum(["can", "bottle"]), confidence: z.number().min(0).max(1) })).max(500),
  summary: z.object({
    cans: z.number().int().min(0),
    bottles: z.number().int().min(0),
    overall_confidence: z.enum(["high", "low"]),
    min_confidence: z.number().min(0).max(1).nullable().optional(),
    reasons: z.array(z.string().max(40)).max(10).optional(),
    not_accepted: z.object({ glass_bottles: z.number().int().min(0) }).partial().optional(),
  }),
});

const TIMEOUT_MS = Number(process.env.ESTIMATOR_TIMEOUT_MS ?? 15_000);
const COOLDOWN_MS = 30_000;
// Circuit breaker: after a failure, fail fast for a short time instead of making every user
// wait for a timeout while the GPU PC is off.
let unavailableUntil = 0;

export function estimatorConfigured() { return Boolean(process.env.ESTIMATOR_URL); }

export async function estimatePhoto(jpeg: Buffer): Promise<Estimate> {
  if (!estimatorConfigured()) return estimateWithFallbackChecker(jpeg);
  if (Date.now() < unavailableUntil) throw new EstimatorUnavailableError("cooldown");
  try {
    const estimate = await estimateWithYolo(jpeg);
    unavailableUntil = 0;
    return estimate;
  } catch (error) {
    if (error instanceof EstimatorUnavailableError) {
      unavailableUntil = Date.now() + COOLDOWN_MS;
      console.error(`[estimator] unavailable (${error.reason}); failing fast for ${COOLDOWN_MS / 1000}s.`);
    }
    throw error;
  }
}

async function estimateWithYolo(jpeg: Buffer): Promise<Estimate> {
  const url = new URL("/detect", process.env.ESTIMATOR_URL);
  const headers: Record<string, string> = { "X-API-Key": process.env.ESTIMATOR_API_KEY ?? "" };
  // Optional Cloudflare Access service token: unauthenticated traffic never reaches the PC.
  if (process.env.ESTIMATOR_CF_ACCESS_CLIENT_ID && process.env.ESTIMATOR_CF_ACCESS_CLIENT_SECRET) {
    headers["CF-Access-Client-Id"] = process.env.ESTIMATOR_CF_ACCESS_CLIENT_ID;
    headers["CF-Access-Client-Secret"] = process.env.ESTIMATOR_CF_ACCESS_CLIENT_SECRET;
  }
  const form = new FormData();
  form.set("image", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "photo.jpg");

  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers, body: form, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store", redirect: "error" });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new EstimatorUnavailableError(timedOut ? `timeout after ${TIMEOUT_MS} ms` : "network error");
  }

  if (response.status === 400 || response.status === 413) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new PhotoRejectedError(body.error === "image_too_large" ? "That photo is too large. Retake it and try again."
      : body.error === "image_too_small" ? "That photo is too small. Retake it closer to the items."
      : "We couldn’t read that photo. Retake a clear photo and try again.");
  }
  if (response.status === 401 || response.status === 403) {
    // A configuration problem on our side, not the user's. Log loudly; the user sees "busy".
    console.error(`[estimator] the detection service rejected our credentials (HTTP ${response.status}). Check ESTIMATOR_API_KEY / Cloudflare Access.`);
    throw new EstimatorUnavailableError(`auth ${response.status}`);
  }
  // 5xx includes Cloudflare's own errors when the tunnel or PC is down (502, 521, 523, 530...).
  if (!response.ok) throw new EstimatorUnavailableError(`HTTP ${response.status}`);

  const parsed = detectSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new EstimatorUnavailableError("unexpected response shape");
  const { status, items, summary } = parsed.data;
  return {
    cans: summary.cans,
    bottles: summary.bottles,
    confidence: summary.min_confidence ?? (items.length ? Math.min(...items.map((item) => item.confidence)) : 1),
    lowConfidence: status === "low_confidence",
    blurry: summary.reasons?.includes("blurry") ?? false,
    glassBottles: summary.not_accepted?.glass_bottles ?? 0,
    source: "YOLO",
  };
}

async function estimateWithFallbackChecker(jpeg: Buffer): Promise<Estimate> {
  try {
    const { result, mode } = await verifyImage(jpeg, "image/jpeg");
    return { cans: result.cans, bottles: result.bottles, confidence: result.confidence, lowConfidence: result.confidence < rules.confidenceThreshold, blurry: false, glassBottles: 0, source: mode };
  } catch (error) {
    // verifyImage already turns provider failures into user-facing messages.
    throw new PhotoRejectedError(error instanceof Error ? error.message : "Photo verification failed. Try a clearer photo.");
  }
}

/** Test hook: reset the circuit breaker. */
export function resetEstimatorForTests() { unavailableUntil = 0; }

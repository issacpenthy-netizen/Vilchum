// Browser side of the photo estimate. It talks only to our own /api/scans route; the Next.js
// server holds the detection service's API key and calls the GPU PC. No secret is ever shipped
// to the browser, so nothing here can be copied out of devtools and replayed against the GPU.

export type ScanEstimate = {
  id: string;
  cans: number;
  bottles: number;
  estimatedPoints: number;
  kg: number;
  status: string;
  lowConfidence: boolean;
  glassBottles: number;
};

export type EstimateOutcome =
  | { state: "success"; scan: ScanEstimate; verifier: string }
  | { state: "low_confidence"; scan: ScanEstimate; verifier: string };

/** The estimator (GPU PC) is offline, asleep, busy, or the request timed out. Show "busy, try again". */
export class EstimatorUnavailableError extends Error {
  constructor(message = "Photo checking is busy right now. Your photo is safe. Try again in a minute.") {
    super(message);
    this.name = "EstimatorUnavailableError";
  }
}

const CLIENT_TIMEOUT_MS = 30_000;

/**
 * Uploads a photo for an estimate. Resolves with "success" or "low_confidence".
 * Throws EstimatorUnavailableError when the service can't answer (offline, timeout, 503),
 * or a plain Error with a user-facing message when the photo itself was rejected.
 * Pass `replaces` when this photo is a retake of an earlier estimate.
 */
export async function uploadImageForEstimate(file: File, options: { replaces?: string } = {}): Promise<EstimateOutcome> {
  const form = new FormData();
  form.set("image", file);
  if (options.replaces) form.set("replaces", options.replaces);

  let response: Response;
  try {
    response = await fetch("/api/scans", { method: "POST", body: form, signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS), credentials: "same-origin" });
  } catch {
    // Offline phone, dropped connection, or our own timeout: same retry advice for the user.
    throw new EstimatorUnavailableError();
  }

  const data = await response.json().catch(() => null) as { scan?: ScanEstimate; verifier?: string; error?: string; code?: string } | null;
  if (response.status === 503 || data?.code === "ESTIMATOR_UNAVAILABLE" || response.status === 502 || response.status === 504) {
    throw new EstimatorUnavailableError(data?.error);
  }
  if (!response.ok || !data?.scan) throw new Error(data?.error ?? "Photo verification failed. Try a clearer photo.");
  return { state: data.scan.lowConfidence ? "low_confidence" : "success", scan: data.scan, verifier: data.verifier ?? "" };
}

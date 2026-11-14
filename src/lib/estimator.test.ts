import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { EstimatorUnavailableError, PhotoRejectedError, estimatePhoto, resetEstimatorForTests } from "./estimator";

const realFetch = globalThis.fetch;
const photo = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
let calls: { url: string; headers: Record<string, string> }[] = [];

function respondWith(handler: () => Response | Promise<Response>) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)) });
    return handler();
  }) as typeof fetch;
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  process.env.ESTIMATOR_URL = "https://detect.vilchum.test";
  process.env.ESTIMATOR_API_KEY = "server-side-key-" + "x".repeat(30);
  delete process.env.ESTIMATOR_CF_ACCESS_CLIENT_ID;
  delete process.env.ESTIMATOR_CF_ACCESS_CLIENT_SECRET;
  calls = [];
  resetEstimatorForTests();
});
after(() => { globalThis.fetch = realFetch; });

test("success: counts come from the summary and the key is sent server-side", async () => {
  respondWith(() => json(200, { status: "success", items: [{ label: "can", confidence: 0.93 }, { label: "bottle", confidence: 0.81 }], summary: { cans: 1, bottles: 1, overall_confidence: "high", min_confidence: 0.81, not_accepted: { glass_bottles: 2 } } }));
  const estimate = await estimatePhoto(photo);
  assert.deepEqual(estimate, { cans: 1, bottles: 1, confidence: 0.81, lowConfidence: false, glassBottles: 2, source: "YOLO" });
  assert.equal(calls[0]!.url, "https://detect.vilchum.test/detect");
  assert.equal(calls[0]!.headers["X-API-Key"], process.env.ESTIMATOR_API_KEY);
});

test("low_confidence is passed through for the UI chip", async () => {
  respondWith(() => json(200, { status: "low_confidence", items: [{ label: "can", confidence: 0.41 }], summary: { cans: 1, bottles: 0, overall_confidence: "low", min_confidence: 0.41 } }));
  const estimate = await estimatePhoto(photo);
  assert.equal(estimate.lowConfidence, true);
  assert.equal(estimate.confidence, 0.41);
});

test("Cloudflare Access service token headers are sent when configured", async () => {
  process.env.ESTIMATOR_CF_ACCESS_CLIENT_ID = "id.access";
  process.env.ESTIMATOR_CF_ACCESS_CLIENT_SECRET = "secret";
  respondWith(() => json(200, { status: "success", items: [], summary: { cans: 0, bottles: 0, overall_confidence: "high" } }));
  await estimatePhoto(photo);
  assert.equal(calls[0]!.headers["CF-Access-Client-Id"], "id.access");
  assert.equal(calls[0]!.headers["CF-Access-Client-Secret"], "secret");
});

test("PC offline (network error) is 'unavailable', then fails fast without calling again", async () => {
  respondWith(() => { throw new TypeError("fetch failed"); });
  await assert.rejects(estimatePhoto(photo), EstimatorUnavailableError);
  await assert.rejects(estimatePhoto(photo), (error: unknown) => error instanceof EstimatorUnavailableError && error.reason === "cooldown");
  assert.equal(calls.length, 1);
});

test("Cloudflare origin errors (tunnel or PC down) are 'unavailable'", async () => {
  for (const status of [502, 503, 521, 523, 530]) {
    resetEstimatorForTests();
    respondWith(() => new Response("<html>Cloudflare error</html>", { status }));
    await assert.rejects(estimatePhoto(photo), EstimatorUnavailableError, `HTTP ${status}`);
  }
});

test("a timeout is 'unavailable'", async () => {
  respondWith(() => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); });
  await assert.rejects(estimatePhoto(photo), (error: unknown) => error instanceof EstimatorUnavailableError && error.reason.startsWith("timeout"));
});

test("wrong credentials are our misconfiguration: 'unavailable' to the user, not their fault", async () => {
  respondWith(() => json(401, { error: "unauthorized" }));
  await assert.rejects(estimatePhoto(photo), EstimatorUnavailableError);
});

test("a corrupt or oversized photo asks the user to retake it", async () => {
  respondWith(() => json(400, { error: "invalid_image" }));
  await assert.rejects(estimatePhoto(photo), PhotoRejectedError);
  respondWith(() => json(413, { error: "image_too_large" }));
  await assert.rejects(estimatePhoto(photo), /too large/);
});

test("an unexpected response shape is never trusted as an estimate", async () => {
  respondWith(() => json(200, { status: "success", items: [{ label: "glass", confidence: 2 }], summary: {} }));
  await assert.rejects(estimatePhoto(photo), EstimatorUnavailableError);
});

test("after the PC comes back, the next call succeeds once the breaker is reset", async () => {
  respondWith(() => { throw new TypeError("fetch failed"); });
  await assert.rejects(estimatePhoto(photo), EstimatorUnavailableError);
  resetEstimatorForTests();
  respondWith(() => json(200, { status: "success", items: [{ label: "bottle", confidence: 0.9 }], summary: { cans: 0, bottles: 1, overall_confidence: "high", min_confidence: 0.9 } }));
  assert.equal((await estimatePhoto(photo)).bottles, 1);
});

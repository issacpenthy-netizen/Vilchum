import { createHash } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const FALLBACK_MODEL = "gemini-3.6-flash";
const TIMEOUT_MS = 25_000;
const resultSchema = z.object({
  cans: z.number().int().min(0).max(200),
  bottles: z.number().int().min(0).max(200),
  confidence: z.number().min(0).max(1),
  issues: z.array(z.string().max(160)).max(6),
});
export type Verification = z.infer<typeof resultSchema>;

const jsonSchema = {
  type: "object",
  properties: {
    cans: { type: "integer" },
    bottles: { type: "integer" },
    confidence: { type: "number" },
    issues: { type: "array", items: { type: "string" } },
  },
  required: ["cans", "bottles", "confidence", "issues"],
};

const PROMPT = "Count only visible aluminium beverage cans and plastic drink bottles. Exclude glass, steel tins, caps, labels, reflections, and hidden items. Return the exact requested JSON counts. Set confidence from 0 to 1 and briefly list any image issue.";
const apiKey = process.env.GEMINI_API_KEY;
const client = apiKey ? new GoogleGenAI({ apiKey, apiVersion: "v1beta" }) : null;
const cache = new Map<string, Verification>();
const CACHE_LIMIT = 100;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("TIMEOUT")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("status" in error && typeof error.status === "number") return error.status;
  if ("statusCode" in error && typeof error.statusCode === "number") return error.statusCode;
  return undefined;
}

export async function verifyImage(
  bytes: Buffer,
  mime: string
): Promise<{ result: Verification; mode: "GEMINI" | "MOCK" }> {
  if (!client) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Photo checking is not configured. Add GEMINI_API_KEY to .env and restart the app.");
    }
    console.warn("GEMINI_API_KEY is missing; using the clearly labelled MOCK photo verifier for local demo only.");
    return { mode: "MOCK", result: { cans: 1, bottles: 1, confidence: 0.9, issues: [] } };
  }

  const key = createHash("sha256").update(bytes).digest("hex");
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return { mode: "GEMINI", result: cached };
  }

  const started = Date.now();
  try {
    const requestModel = (model: string) => withTimeout(client.interactions.create({
        model,
        input: [
          { type: "text", text: PROMPT },
          { type: "image", data: bytes.toString("base64"), mime_type: mime },
        ],
        response_format: { type: "text", mime_type: "application/json", schema: jsonSchema },
        generation_config: { thinking_level: "low", max_output_tokens: 128 },
      }, { timeout_ms: TIMEOUT_MS, retries: { strategy: "none" } }), TIMEOUT_MS + 1000);

    let model = MODEL;
    let interaction: Awaited<ReturnType<typeof requestModel>>;
    try {
      interaction = await requestModel(model);
    } catch (error) {
      if (httpStatus(error) !== 404 || model === FALLBACK_MODEL) throw error;
      model = FALLBACK_MODEL;
      console.warn(`Gemini model ${MODEL} was not found; retrying with ${FALLBACK_MODEL}.`);
      interaction = await requestModel(model);
    }

    if (!interaction.output_text) throw new Error("EMPTY_RESPONSE");
    const parsed = resultSchema.safeParse(JSON.parse(interaction.output_text));
    if (!parsed.success) throw new Error("INVALID_RESPONSE");
    console.info(`Gemini image verification completed in ${Date.now() - started} ms (${bytes.length} bytes, ${model}).`);
    cache.set(key, parsed.data);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
    return { mode: "GEMINI", result: parsed.data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorName = error instanceof Error ? error.name : "UnknownError";
    console.error(`Gemini image verification failed after ${Date.now() - started} ms (${errorName}, HTTP ${httpStatus(error) ?? "none"}):`, message.slice(0, 240));
    if (error instanceof Error && error.message === "INVALID_RESPONSE") {
      throw new Error("The photo check returned an unreadable result. Retake a clear photo and try again.");
    }
    if (error instanceof Error && error.message === "EMPTY_RESPONSE") {
      throw new Error("The photo check could not read the image. Retake a clear photo and try again.");
    }
    if (/fetch failed|connection|econn|eacces|enotfound|network/i.test(message)) {
      throw new Error("Cannot connect to Gemini. Check your internet connection and GEMINI_API_KEY, then try again.");
    }
    if (/timeout|timed out/i.test(message) || errorName === "AbortError") {
      throw new Error("Gemini took too long to check this photo. Check your connection and try again.");
    }
    const status = httpStatus(error);
    if (status === 401 || /(unauthorized|api key)/i.test(message)) {
      throw new Error("Gemini rejected the API key. Check GEMINI_API_KEY in .env, then restart the app.");
    }
    if (status === 403 || /permission denied|forbidden/i.test(message)) {
      throw new Error("Gemini denied this API key. Check that the Gemini API is enabled for its Google project.");
    }
    if (status === 404) {
      throw new Error("The Gemini model is unavailable. Check GEMINI_MODEL in .env, then restart the app.");
    }
    if (status === 429) {
      throw new Error("Gemini is temporarily rate-limited. Wait a moment, then try the photo again.");
    }
    if (status === 400) {
      const details = process.env.NODE_ENV === "production" ? "" : ` Details: ${message.slice(0, 180)}`;
      throw new Error(`Gemini rejected the photo request. Check the request format and model settings, then try again.${details}`);
    }
    const details = process.env.NODE_ENV === "production" ? "" : ` Details: HTTP ${status ?? "none"} ${message.slice(0, 180)}`;
    throw new Error(`Gemini could not check this photo. Check the server log for details, then try again.${details}`);
  }
}

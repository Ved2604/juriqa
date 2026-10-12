import { models } from "./gemini";

/** Overload, rate-limit or quota errors: worth retrying or switching model. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const DELAYS_MS = [1000, 3000];

export class AiUnavailableError extends Error {
  constructor() {
    super("The AI service is busy right now. Please try again in a moment.");
  }
}

function statusOf(e: unknown): number | undefined {
  if (e && typeof e === "object" && "status" in e && typeof e.status === "number") return e.status;
  return undefined;
}

/**
 * Start a Gemini call, retrying overload/quota errors with growing waits, then
 * falling back to GEMINI_FALLBACK_MODEL. Only wraps the *start* of a call;
 * once a stream has produced output it is not retried.
 */
export async function withRetry<T>(fn: (model: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (const model of models()) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn(model);
      } catch (e) {
        if (signal?.aborted) throw e;
        const status = statusOf(e);
        if (status === undefined || !RETRYABLE.has(status)) throw e;
        // Quota errors won't clear in seconds; move straight to the fallback model.
        if (status === 429 || attempt >= DELAYS_MS.length) {
          console.warn(`Gemini model ${model} unavailable (${status}); trying fallback if configured`);
          break;
        }
        await new Promise((r) => setTimeout(r, DELAYS_MS[attempt]));
      }
    }
  }
  throw new AiUnavailableError();
}

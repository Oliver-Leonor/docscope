/**
 * Exponential-backoff retry helper for OpenAI SDK calls that fail with
 * HTTP 429 (rate-limit) errors.
 *
 * Behavior:
 *   - Runs `fn()` once. If it throws an error whose `status` is 429,
 *     waits `initialDelayMs` (default 2000ms) and retries.
 *   - After each 429, the delay doubles (2s → 4s → 8s by default).
 *   - Gives up after `maxRetries` additional attempts (default 3), for
 *     a maximum of 4 total tries.
 *   - Any non-429 error propagates immediately — we don't want to mask
 *     auth failures, validation errors, or server 5xxs behind a retry
 *     loop.
 *
 * Usage:
 *
 *   const response = await withRetry(() =>
 *     openai.chat.completions.create({ model, messages, ... }),
 *   )
 *
 * The OpenAI Node SDK throws `APIError` subclasses with a numeric
 * `status` field matching the HTTP status code, so a duck-typed check
 * on `err.status === 429` is sufficient and avoids coupling this
 * module to a specific SDK class.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; initialDelayMs?: number } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3
  const initialDelayMs = options.initialDelayMs ?? 2000

  let delay = initialDelayMs
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (!isRateLimitError(err)) throw err
      if (attempt === maxRetries) break
      console.warn(
        `[retry] 429 rate limit, retrying in ${delay}ms ` +
          `(attempt ${attempt + 1}/${maxRetries})`,
      )
      await sleep(delay)
      delay *= 2
    }
  }

  throw lastError
}

/**
 * Duck-typed check for a 429 rate-limit error. The OpenAI SDK surfaces
 * HTTP status codes on its `APIError` instances as a numeric `status`
 * property, so checking `err.status === 429` catches every flavor
 * (`RateLimitError`, `APIError`, plain `fetch` errors rethrown by the
 * SDK wrapper) without importing and `instanceof`-matching individual
 * error classes.
 */
function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  return (err as { status?: unknown }).status === 429
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

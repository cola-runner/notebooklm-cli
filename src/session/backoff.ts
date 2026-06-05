/**
 * Exponential backoff helper with jitter.
 *
 * Ported from `notebooklm-py/src/notebooklm/_backoff.py`.
 */

export interface BackoffConfig {
  /** Base delay in seconds (doubled each attempt). Default: 1.0 */
  base?: number;
  /** Maximum delay in seconds. Default: 60.0 */
  cap?: number;
  /** Random jitter ratio (0..1). Default: 0.1 */
  jitter?: number;
}

/** Compute backoff delay (in ms) for the given attempt (0-indexed). */
export function computeBackoffMs(attempt: number, config: BackoffConfig = {}): number {
  const base = config.base ?? 1.0;
  const cap = config.cap ?? 60.0;
  const jitter = config.jitter ?? 0.1;
  const raw = Math.min(base * 2 ** attempt, cap);
  const jitterAmount = raw * jitter * (Math.random() * 2 - 1);
  return Math.max(0, (raw + jitterAmount) * 1000);
}

/** Hard ceiling for honoring `Retry-After` headers. */
export const MAX_RETRY_AFTER_SECONDS = 300;

export function parseRetryAfter(header: string | string[] | undefined): number | null {
  if (!header) return null;
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
  }
  // HTTP-date format
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const diff = (date.getTime() - Date.now()) / 1000;
  if (diff < 0) return 0;
  return Math.min(diff, MAX_RETRY_AFTER_SECONDS);
}

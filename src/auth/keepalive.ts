/**
 * Keepalive `RotateCookies` poke.
 *
 * Google's `__Secure-1PSIDTS` / `__Secure-3PSIDTS` cookies rotate frequently
 * (minutes-to-hours scale); pure RPC traffic never triggers a rotation, so
 * a long-lived `storage_state.json` quietly stales out. We POST to
 * `accounts.google.com/RotateCookies` (the dedicated rotation endpoint Chrome
 * itself calls) to refresh them.
 *
 * The Python version has elaborate multi-process / multi-loop flock + async
 * lock coordination. This v0.1 ports the in-process rate limit only — the
 * cross-process and async-lock layers can be added when we hit those
 * scenarios.
 */

import { setTimeout as delay } from 'node:timers/promises';
import { request } from 'undici';
import { DISABLE_KEEPALIVE_ENV_VAR } from './paths.js';

export const KEEPALIVE_ROTATE_URL = 'https://accounts.google.com/RotateCookies';
const KEEPALIVE_BODY = '[000,"-0000000000000000000"]';
const KEEPALIVE_TIMEOUT_MS = 15_000;
/**
 * Skip the poke if we attempted within this window. Google's own declared
 * rotation cadence is 600s; 60s is well under the useful interval.
 */
const RATE_LIMIT_MS = 60_000;

/** Monotonic timestamp of last attempt, keyed by storage path. */
const lastAttempt = new Map<string, number>();

function tryClaimRotation(storagePath: string): boolean {
  const now = performance.now();
  const last = lastAttempt.get(storagePath) ?? 0;
  if (last > 0 && now - last < RATE_LIMIT_MS) {
    return false;
  }
  lastAttempt.set(storagePath, now);
  return true;
}

export interface RotateOptions {
  /** Provide a cookie header to send with the rotate POST. */
  cookieHeader: string;
  /** Storage path used as rate-limit key. */
  storagePath: string;
  /** Override timeout in ms. */
  timeoutMs?: number;
}

export interface RotateResult {
  /** Cookies returned by the rotate endpoint (parsed from Set-Cookie). */
  setCookies: string[];
  /** Whether we actually POSTed (false = rate-limited or disabled). */
  posted: boolean;
}

/**
 * Best-effort POST to `accounts.google.com/RotateCookies`. Failures are
 * swallowed — this is purely a freshness optimisation.
 *
 * Returns the set-cookie strings so the caller can update its cookie store.
 */
export async function rotateCookies(opts: RotateOptions): Promise<RotateResult> {
  if (process.env[DISABLE_KEEPALIVE_ENV_VAR] === '1') {
    return { setCookies: [], posted: false };
  }
  if (!tryClaimRotation(opts.storagePath)) {
    return { setCookies: [], posted: false };
  }
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? KEEPALIVE_TIMEOUT_MS);
    try {
      const res = await request(KEEPALIVE_ROTATE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://accounts.google.com',
          Cookie: opts.cookieHeader,
        },
        body: KEEPALIVE_BODY,
        signal: controller.signal,
      });
      // Drain body so the connection can be reused
      await res.body.text();
      const raw = res.headers['set-cookie'];
      const setCookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
      return { setCookies, posted: res.statusCode === 200 };
    } finally {
      clearTimeout(t);
    }
  } catch {
    // Best-effort; swallow errors.
    return { setCookies: [], posted: true };
  }
}

/** Test-only: clear the rate-limit cache between tests. */
export function _resetKeepaliveStateForTests(): void {
  lastAttempt.clear();
}

// Re-export delay for convenience in callers that need backoff.
export { delay };

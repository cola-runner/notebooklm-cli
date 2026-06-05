/**
 * Auth-related types — storage state, cookies, tokens.
 *
 * The `StorageState` shape is intentionally compatible with Playwright's
 * `BrowserContext.storageState()` output so we can use Playwright's login
 * flow and persist its file directly.
 */

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface StorageState {
  cookies: StoredCookie[];
  origins?: unknown[];
}

/** Tokens extracted from the homepage HTML on each cold start / refresh. */
export interface AuthTokens {
  csrf: string;
  sessionId: string;
  /** When `csrf`/`sessionId` were extracted (epoch ms) — used to expire. */
  extractedAt: number;
}

/**
 * Storage state persistence — reads/writes `storage_state.json`.
 *
 * The file format is identical to Playwright's `BrowserContext.storageState()`
 * so we can use Playwright's login flow without translation.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { ensureStorageDir } from './paths.js';
import type { StorageState, StoredCookie } from './types.js';

const REQUIRED_COOKIE_NAMES = new Set(['SID', '__Secure-1PSID', '__Secure-3PSID']);

/**
 * Read storage_state.json from disk. Returns `null` if the file does not exist.
 */
export async function loadStorageState(path: string): Promise<StorageState | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as StorageState;
    if (!Array.isArray(parsed.cookies)) {
      throw new Error('storage_state.json missing cookies array');
    }
    return parsed;
  } catch (err) {
    throw new Error(`Invalid storage_state.json at ${path}: ${(err as Error).message}`);
  }
}

/** Write the storage state atomically (write to tmp + rename). */
export async function saveStorageState(path: string, state: StorageState): Promise<void> {
  ensureStorageDir(path);
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  const { rename } = await import('node:fs/promises');
  await rename(tmp, path);
}

/**
 * Verify the cookie set contains at least one primary SID identifier.
 * Returns the missing-required list (empty = OK).
 */
export function findMissingRequiredCookies(state: StorageState): string[] {
  const present = new Set(state.cookies.map((c) => c.name));
  const hasAny = [...REQUIRED_COOKIE_NAMES].some((n) => present.has(n));
  if (hasAny) return [];
  return [...REQUIRED_COOKIE_NAMES];
}

/** Pick a cookie by name (first match wins). */
export function findCookie(state: StorageState, name: string): StoredCookie | undefined {
  return state.cookies.find((c) => c.name === name);
}

/** Build a `Cookie:` header value from the stored state, filtered by domain. */
export function buildCookieHeader(state: StorageState, host: string): string {
  return state.cookies
    .filter((c) => matchesHost(c.domain, host))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

function matchesHost(cookieDomain: string, host: string): boolean {
  if (!cookieDomain) return false;
  // Cookie domains often start with `.` for parent-domain matches
  const normalized = cookieDomain.startsWith('.') ? cookieDomain.slice(1) : cookieDomain;
  return host === normalized || host.endsWith(`.${normalized}`);
}

/**
 * Auto-capture login — the closest thing to a one-click ("OAuth-style") sign-in.
 *
 * NotebookLM has no public API or OAuth scope; its internal RPC backend only
 * accepts a real browser session cookie. So instead of asking the user to copy
 * a cURL by hand, we open their real Chrome/Edge/Brave, let them sign in
 * normally, and read the resulting cookies — already decrypted, so no OS
 * keychain access is needed.
 *
 * This mirrors `notebooklm-py`'s `notebooklm login` (cli/session.py): Playwright
 * drives the *real* browser (via `executablePath`, not the bundled Chromium)
 * with the automation markers stripped (`--disable-blink-features=
 * AutomationControlled` + dropping `--enable-automation`), so Google's "this
 * browser may not be secure" block does not fire. A persistent profile is
 * reused across logins, so a repeat sign-in is instant.
 *
 * Works for users who have never signed in anywhere — they just log in inside
 * the window we open.
 */

import { type BrowserContext, type Cookie, chromium } from 'playwright';
import { findChromiumBrowser } from '../auth/browserLocator.js';
import { ensureStorageDir, getStoragePath, loginProfileDir } from '../auth/paths.js';
import { findMissingRequiredCookies } from '../auth/storage.js';
import type { StorageState, StoredCookie } from '../auth/types.js';
import { getBaseUrl } from '../env.js';
import { type VerifyAndSaveOptions, verifyAndSave } from './loginShared.js';

export interface BrowserLoginOptions {
  storagePath?: string;
  /** Skip the live verification call before saving (default: verify). */
  verify?: boolean;
  /** Max time to wait for the user to finish signing in (default 5 min). */
  timeoutMs?: number;
}

const POLL_INTERVAL_MS = 1_500;
const SETTLE_MS = 3_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isGoogleDomain(domain: string): boolean {
  const d = domain.replace(/^\./, '');
  return d === 'google.com' || d.endsWith('.google.com');
}

function toStoredCookie(c: Cookie): StoredCookie {
  const stored: StoredCookie = {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
  };
  if (typeof c.expires === 'number' && c.expires > 0) stored.expires = c.expires;
  if (c.sameSite) stored.sameSite = c.sameSite;
  return stored;
}

/** Poll the live browser until the required session cookies appear. */
async function captureSession(context: BrowserContext, deadline: number): Promise<StorageState> {
  let announced = false;
  while (Date.now() < deadline) {
    const cookies = (await context.cookies()).filter((c) => isGoogleDomain(c.domain));
    const state: StorageState = { cookies: cookies.map(toStoredCookie), origins: [] };
    if (findMissingRequiredCookies(state).length === 0) {
      // The post-login redirect dance sets cookies in bursts. Capturing the
      // instant the SID cookie appears can miss the SAPISID/SID variants the
      // RPC needs (observed: a too-early 19-cookie grab was rejected, while the
      // settled set authenticates). Let them settle, then capture the full set.
      console.error('  …session detected, letting cookies settle…');
      await delay(SETTLE_MS);
      const settled = (await context.cookies()).filter((c) => isGoogleDomain(c.domain));
      return { cookies: settled.map(toStoredCookie), origins: [] };
    }
    if (!announced && cookies.length > 0) {
      console.error('  …signed in to Google, waiting for the NotebookLM session…');
      announced = true;
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(
    'Timed out waiting for sign-in. Re-run `notebooklm login` and complete Google sign-in in the window.',
  );
}

export async function runBrowserLogin(opts: BrowserLoginOptions = {}): Promise<void> {
  const choice = findChromiumBrowser();
  if (!choice) {
    throw new Error(
      'No Chromium-family browser found (Chrome / Edge / Brave / Chromium).\n' +
        '  Install one, or sign in with: notebooklm login --paste',
    );
  }

  const storagePath = opts.storagePath ?? getStoragePath();
  const profileDir = loginProfileDir(storagePath);
  ensureStorageDir(storagePath);

  console.error(`Opening ${choice.name} — sign in to NotebookLM in the new window.`);
  console.error('(Nothing is typed for you; I only read the session cookie once you are in.)');

  // Drive the *real* browser with automation markers stripped, so Google does
  // not flag it as an automated ("insecure") browser. Mirrors notebooklm-py.
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: choice.path,
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60 * 1000);
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${getBaseUrl()}/`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);

    const state = await captureSession(context, deadline);
    console.error(`✓ Captured ${state.cookies.length} cookies from ${choice.name}.`);

    const saveOpts: VerifyAndSaveOptions = {};
    if (opts.verify !== undefined) saveOpts.verify = opts.verify;
    saveOpts.storagePath = storagePath;
    await verifyAndSave(state, saveOpts);
    console.error('  Done — closing the helper window. Try:  notebooklm list');
  } finally {
    // Keep the persistent profile on disk so the next login stays signed in.
    await context.close().catch(() => undefined);
  }
}

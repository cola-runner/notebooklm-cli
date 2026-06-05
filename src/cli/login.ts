/**
 * Interactive Playwright login flow.
 *
 * Opens a Chromium window pointed at notebooklm.google.com, waits for the
 * user to complete the Google sign-in, then captures `storage_state.json`.
 * Format is identical to Playwright's `BrowserContext.storageState()` so we
 * persist it directly.
 */

import { chromium } from 'playwright';
import { BROWSER_USER_AGENT } from '../auth/headers.js';
import { ensureStorageDir, getStoragePath } from '../auth/paths.js';
import { saveStorageState } from '../auth/storage.js';
import type { StorageState } from '../auth/types.js';
import { getBaseUrl } from '../env.js';

export interface LoginOptions {
  storagePath?: string;
  /** Run Chromium headlessly (only useful if cookies are pre-injected). */
  headless?: boolean;
}

export async function runLogin(opts: LoginOptions = {}): Promise<{ storagePath: string }> {
  const storagePath = opts.storagePath ?? getStoragePath();
  ensureStorageDir(storagePath);

  const browser = await chromium.launch({ headless: opts.headless ?? false });
  try {
    const context = await browser.newContext({
      userAgent: BROWSER_USER_AGENT,
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    await page.goto(getBaseUrl(), { waitUntil: 'domcontentloaded' });

    console.error('[notebooklm-node] Complete sign-in in the browser window…');
    console.error('[notebooklm-node] Waiting for redirect to notebooklm.google.com home…');

    // Wait until the URL settles back on notebooklm.google.com with the
    // chrome present (look for the SNlM0e marker in the page).
    const TIMEOUT_MS = 5 * 60 * 1000;
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      const url = page.url();
      if (url.startsWith('https://notebooklm.google.com')) {
        const html = await page.content();
        if (html.includes('SNlM0e')) break;
      }
      await page.waitForTimeout(1000);
    }
    if (Date.now() >= deadline) {
      throw new Error('Login timed out after 5 minutes');
    }

    const state = (await context.storageState()) as StorageState;
    await saveStorageState(storagePath, state);
    console.error(`[notebooklm-node] Saved storage state to ${storagePath}`);
    return { storagePath };
  } finally {
    await browser.close();
  }
}

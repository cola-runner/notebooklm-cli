/**
 * Cookie-paste login flow — a cross-platform fallback when browser capture
 * and local browser-cookie import are unavailable.
 *
 * The user copies a request as cURL from their normal, already-signed-in
 * browser (DevTools → Network → right-click → "Copy as cURL") and pastes it
 * here. We extract the `Cookie:` header, optionally verify it against the live
 * API, then persist a `storage_state.json`.
 *
 * This avoids Google's automation block (Playwright login) and any OS keychain
 * access (Chrome cookie decrypt), and works on every platform/browser — see
 * `auth/curlCookies.ts` for the rationale.
 */

import { readFile } from 'node:fs/promises';
import { cookiesToStorageState, parseCurlCookies } from '../auth/curlCookies.js';
import { findMissingRequiredCookies } from '../auth/storage.js';
import { type VerifyAndSaveOptions, readAllStdin, verifyAndSave } from './loginShared.js';

export interface PasteLoginOptions {
  storagePath?: string;
  /** Read the curl/cookie text from a file instead of stdin. */
  curlFile?: string;
  /** Pass the curl/cookie text directly (e.g. `--cookies "$(pbpaste)"`). */
  cookies?: string;
  /** Skip the live verification call before saving (default: verify). */
  verify?: boolean;
}

const INSTRUCTIONS = `
gemini-notebook login — paste your browser session
──────────────────────────────────────────────
  1. Open https://notebook.google.com in your normal browser (signed in).
  2. Open DevTools (F12 / Cmd-Opt-I) and switch to the Network tab.
  3. Reload the page, then right-click any request to notebook.google.com.
  4. Choose  Copy → Copy as cURL  (use the "bash" variant on Windows).
  5. Paste it below, then press Enter and Ctrl-D.

Tip — skip the prompt entirely with your clipboard:
    pbpaste | gemini-notebook login                 # macOS
    xclip -o -sel clip | gemini-notebook login      # Linux
    powershell Get-Clipboard | gemini-notebook login  # Windows

Waiting for pasted cURL / Cookie header …`;

async function readInput(opts: PasteLoginOptions): Promise<string> {
  if (opts.cookies?.trim()) return opts.cookies;
  if (opts.curlFile) return readFile(opts.curlFile, 'utf8');
  // Piped input (e.g. `pbpaste | gemini-notebook login`) — read it silently.
  if (!process.stdin.isTTY) return readAllStdin();
  // Interactive: show instructions, then read the pasted block to EOF.
  console.error(INSTRUCTIONS);
  return readAllStdin();
}

export async function runPasteLogin(opts: PasteLoginOptions = {}): Promise<void> {
  const raw = await readInput(opts);
  const pairs = parseCurlCookies(raw);

  if (pairs.length === 0) {
    console.error(
      '\n✗ No cookies found in the pasted text.\n' +
        '  Make sure you used "Copy as cURL" (or pasted a Cookie: header), then try again.',
    );
    process.exit(1);
  }

  const state = cookiesToStorageState(pairs);
  const missing = findMissingRequiredCookies(state);
  if (missing.length > 0) {
    console.error(
      `\n✗ Found ${pairs.length} cookies, but none of the required session cookies (${missing.join(', ')}).
  Are you signed in to Gemini Notebook in that browser? Copy the cURL of a request
  to notebook.google.com (not accounts.google.com) and try again.`,
    );
    process.exit(1);
  }

  const saveOpts: VerifyAndSaveOptions = {};
  if (opts.verify !== undefined) saveOpts.verify = opts.verify;
  if (opts.storagePath) saveOpts.storagePath = opts.storagePath;
  await verifyAndSave(state, saveOpts);
  console.error('  Try it:  gemini-notebook list');
}

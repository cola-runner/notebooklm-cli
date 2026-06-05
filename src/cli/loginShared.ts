/**
 * Shared tail for every login flow: verify candidate cookies against the live
 * API, then persist them to `storage_state.json`.
 */

import { getStoragePath } from '../auth/paths.js';
import { saveStorageState } from '../auth/storage.js';
import type { StorageState } from '../auth/types.js';
import { NotebookLMClient } from '../client.js';
import { AuthError } from '../rpc/errors.js';

export interface VerifyAndSaveOptions {
  storagePath?: string;
  /** Skip the live verification call before saving (default: verify). */
  verify?: boolean;
}

/** Read all of stdin to EOF (used by the paste flow and the pipe peek). */
export function readAllStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
    process.stdin.resume();
  });
}

/**
 * Probe the candidate cookies with a real `notebooks.list()` call, then save.
 *
 * On a rejected session we throw (the cookies are bad — don't persist them).
 * On a transient network/proxy error we warn and save anyway, so an offline or
 * proxy-flaky run still captures the session rather than discarding it.
 */
export async function verifyAndSave(
  state: StorageState,
  opts: VerifyAndSaveOptions = {},
): Promise<void> {
  // Save first. A just-completed interactive sign-in produces good cookies by
  // construction, so a later verify failure is far more likely transient
  // (proxy/network) than bad cookies — don't discard them. Verify is an
  // informational check, not a gate.
  const path = opts.storagePath ?? getStoragePath();
  await saveStorageState(path, state);
  console.error(`✓ Saved ${state.cookies.length} cookies → ${path}`);

  if (opts.verify === false) return;

  const client = NotebookLMClient.fromState(state, {
    disableKeepalive: true,
    readOnlyStorage: true,
  });
  try {
    const notebooks = await client.notebooks.list();
    console.error(`✓ Verified — signed in, ${notebooks.length} notebook(s) visible.`);
  } catch (err) {
    const reason = err instanceof AuthError ? 'session was rejected' : (err as Error).message;
    console.error(`⚠ Saved, but could not verify (${reason}).`);
    console.error('  If commands fail, re-run `notebooklm login` or check your proxy settings.');
  }
}

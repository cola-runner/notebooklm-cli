/**
 * Shared CLI helpers — client construction and error rendering.
 */

import { NotebookLMClient } from '../client.js';
import { fail } from './output.js';

/**
 * Open a client from storage, honoring an optional `--storage` override.
 *
 * Keepalive cookie rotation is disabled for the CLI: each command is a short-
 * lived process, and the in-process rotation throttle does not carry across
 * processes — rotating `__Secure-1PSIDTS` on every invocation degrades the
 * session and triggers homepage redirect loops. Imported cookies stay valid
 * long enough for interactive CLI use without per-call rotation.
 */
export async function openClient(storage: string | undefined): Promise<NotebookLMClient> {
  const opts: Parameters<typeof NotebookLMClient.fromStorage>[0] = {
    disableKeepalive: true,
    readOnlyStorage: true,
  };
  if (storage) opts.storagePath = storage;
  return NotebookLMClient.fromStorage(opts);
}

/** Print a human-friendly error and exit with a class-specific code. */
export function handleError(err: unknown): never {
  return fail({}, err);
}

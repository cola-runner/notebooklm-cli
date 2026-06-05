/**
 * Filesystem paths for auth storage.
 *
 * Default location: `~/.config/notebooklm-node/storage_state.json`.
 * Override via `NOTEBOOKLM_STORAGE` env var.
 */

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const STORAGE_ENV_VAR = 'NOTEBOOKLM_STORAGE';
export const REFRESH_CMD_ENV_VAR = 'NOTEBOOKLM_REFRESH_CMD';
export const DISABLE_KEEPALIVE_ENV_VAR = 'NOTEBOOKLM_DISABLE_KEEPALIVE_POKE';

export function defaultStoragePath(): string {
  return join(homedir(), '.config', 'notebooklm-node', 'storage_state.json');
}

export function getStoragePath(): string {
  return process.env[STORAGE_ENV_VAR] ?? defaultStoragePath();
}

export function ensureStorageDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

export function rotationLockPath(storagePath: string): string {
  const dir = dirname(storagePath);
  const name = storagePath.slice(dir.length + 1);
  return join(dir, `.${name}.rotate.lock`);
}

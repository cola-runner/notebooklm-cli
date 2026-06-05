/**
 * Filesystem paths for auth storage.
 *
 * Default location: `~/.config/notebooklm-cli/storage_state.json`.
 * Override via `NOTEBOOKLM_STORAGE` env var.
 */

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const STORAGE_ENV_VAR = 'NOTEBOOKLM_STORAGE';
export const REFRESH_CMD_ENV_VAR = 'NOTEBOOKLM_REFRESH_CMD';
export const DISABLE_KEEPALIVE_ENV_VAR = 'NOTEBOOKLM_DISABLE_KEEPALIVE_POKE';

export function defaultStoragePath(): string {
  return join(homedir(), '.config', 'notebooklm-cli', 'storage_state.json');
}

export function getStoragePath(): string {
  return process.env[STORAGE_ENV_VAR] ?? defaultStoragePath();
}

export function ensureStorageDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

/**
 * Persistent browser profile used by the auto-capture login, kept next to the
 * storage file so the same `--storage` override groups them. Reusing it across
 * logins means the user stays signed in and re-login is instant.
 */
export function loginProfileDir(storagePath: string): string {
  return join(dirname(storagePath), 'login-profile');
}

export function rotationLockPath(storagePath: string): string {
  const dir = dirname(storagePath);
  const name = storagePath.slice(dir.length + 1);
  return join(dir, `.${name}.rotate.lock`);
}

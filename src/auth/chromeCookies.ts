/**
 * Import Google/Gemini Notebook session cookies from a local Google Chrome profile
 * on macOS, producing a Playwright-compatible `StorageState`.
 *
 * Why this exists: Google blocks sign-in inside Playwright-controlled browsers
 * ("this browser may not be secure"), so the only reliable way to obtain a
 * session is to reuse the one already present in the user's real Chrome. This
 * mirrors `notebooklm-py`'s `--browser-cookies` path (which uses the native
 * `rookiepy` library); here we decrypt Chrome's cookie store directly.
 *
 * macOS Chrome cookie encryption:
 *  - Values are prefixed with ASCII "v10", then AES-128-CBC encrypted.
 *  - Key = PBKDF2-HMAC-SHA1(keychainPassword, "saltysalt", 1003, 16).
 *  - keychainPassword comes from Keychain item "Chrome Safe Storage".
 *  - IV is 16 bytes of 0x20 (space).
 *  - Recent Chrome (~M130+) prepends a 32-byte SHA-256 domain hash to the
 *    decrypted plaintext, which we strip heuristically.
 *
 * Scope: only `*.google.com` cookies are read — the minimum needed for auth.
 */

import { execFile } from 'node:child_process';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { StorageState, StoredCookie } from './types.js';

const execFileAsync = promisify(execFile);

const SALT = 'saltysalt';
const ITERATIONS = 1003;
const KEY_LENGTH = 16;
const IV = Buffer.alloc(16, 0x20); // 16 spaces
const KEYCHAIN_SERVICE = 'Chrome Safe Storage';
// Windows epoch (1601-01-01) to Unix epoch (1970-01-01) offset in seconds.
const WINDOWS_EPOCH_OFFSET_SECONDS = 11_644_473_600;

function chromeBaseDir(): string {
  return join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
}

/** Resolve the Cookies SQLite path for a profile (recent Chrome uses Network/). */
function resolveCookiesPath(profile: string): string {
  const base = join(chromeBaseDir(), profile);
  const networkPath = join(base, 'Network', 'Cookies');
  if (existsSync(networkPath)) return networkPath;
  const legacyPath = join(base, 'Cookies');
  if (existsSync(legacyPath)) return legacyPath;
  throw new Error(
    `No Cookies database found for Chrome profile "${profile}". Looked in:\n  ${networkPath}\n  ${legacyPath}\nPass a different --profile (e.g. "Profile 1") if you use multiple Chrome profiles.`,
  );
}

/** Read the Chrome Safe Storage password from the macOS Keychain (prompts the user). */
async function getKeychainPassword(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('security', [
      'find-generic-password',
      '-w',
      '-s',
      KEYCHAIN_SERVICE,
    ]);
    const pw = stdout.trim();
    if (!pw) throw new Error('empty password');
    return pw;
  } catch (err) {
    throw new Error(
      `Could not read the "Chrome Safe Storage" key from the macOS Keychain. When the keychain dialog appears, click "Allow" (not "Deny"). Underlying error: ${(err as Error).message}`,
    );
  }
}

interface RawCookieRow {
  host: string;
  name: string;
  encryptedHex: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expiresUtc: bigint;
}

/** Copy the cookie DB (+ WAL/SHM sidecars) to temp and dump google.com rows via sqlite3. */
async function readGoogleCookieRows(cookiesPath: string): Promise<RawCookieRow[]> {
  const stamp = `${process.pid}-${Date.now()}`;
  const tmpDb = join(tmpdir(), `nblm-cookies-${stamp}`);
  await copyFile(cookiesPath, tmpDb);
  // Best-effort copy of WAL/SHM so recently-written cookies are visible.
  for (const suffix of ['-wal', '-shm']) {
    const src = `${cookiesPath}${suffix}`;
    if (existsSync(src)) await copyFile(src, `${tmpDb}${suffix}`);
  }

  const sql =
    'SELECT host_key, name, hex(encrypted_value), path, is_secure, is_httponly, expires_utc ' +
    "FROM cookies WHERE host_key LIKE '%google.com';";
  const { stdout } = await execFileAsync('sqlite3', ['-separator', '\t', tmpDb, sql]);

  const rows: RawCookieRow[] = [];
  for (const line of stdout.split('\n')) {
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length < 7) continue;
    rows.push({
      host: parts[0]!,
      name: parts[1]!,
      encryptedHex: parts[2]!,
      path: parts[3]!,
      secure: parts[4] === '1',
      httpOnly: parts[5] === '1',
      expiresUtc: BigInt(parts[6]!),
    });
  }
  return rows;
}

function isPrintableAscii(buf: Buffer): boolean {
  for (const byte of buf) {
    if (byte < 0x20 || byte > 0x7e) return false;
  }
  return true;
}

/** Decrypt a single `v10`-prefixed cookie value; returns null if undecryptable. */
function decryptValue(encryptedHex: string, key: Buffer): string | null {
  const data = Buffer.from(encryptedHex, 'hex');
  if (data.length <= 3 || data.subarray(0, 3).toString('ascii') !== 'v10') {
    // Unencrypted or unknown scheme — treat the remainder as plaintext.
    return data.toString('utf8');
  }
  const ciphertext = data.subarray(3);
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, IV);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (isPrintableAscii(plain)) return plain.toString('utf8');
    // Newer Chrome prepends a 32-byte SHA-256 domain hash to the plaintext.
    if (plain.length > 32 && isPrintableAscii(plain.subarray(32))) {
      return plain.subarray(32).toString('utf8');
    }
    return plain.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Extract and decrypt `*.google.com` cookies from a Chrome profile into a
 * Playwright-compatible StorageState.
 *
 * @param profile Chrome profile directory name (default "Default").
 */
export async function importChromeCookies(profile = 'Default'): Promise<StorageState> {
  if (process.platform !== 'darwin') {
    throw new Error('Chrome cookie import is currently implemented for macOS only.');
  }
  const cookiesPath = resolveCookiesPath(profile);
  const [password, rows] = await Promise.all([
    getKeychainPassword(),
    readGoogleCookieRows(cookiesPath),
  ]);
  const key = pbkdf2Sync(password, SALT, ITERATIONS, KEY_LENGTH, 'sha1');

  const cookies: StoredCookie[] = [];
  for (const row of rows) {
    const value = decryptValue(row.encryptedHex, key);
    if (value === null || value === '') continue;
    const cookie: StoredCookie = {
      name: row.name,
      value,
      domain: row.host,
      path: row.path || '/',
      secure: row.secure,
      httpOnly: row.httpOnly,
    };
    if (row.expiresUtc > 0n) {
      cookie.expires = Number(row.expiresUtc / 1_000_000n) - WINDOWS_EPOCH_OFFSET_SECONDS;
    }
    cookies.push(cookie);
  }

  return { cookies, origins: [] };
}

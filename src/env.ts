/**
 * Environment configuration — base URLs and host allowlist.
 *
 * Ported from `notebooklm-py/src/notebooklm/_env.py`.
 */

export const DEFAULT_BASE_URL = 'https://notebooklm.google.com';

const ENV_VAR = 'NOTEBOOKLM_BASE_URL';

/**
 * Hosts allowed for the base URL. Override gating uses this set as a defense
 * in depth so RPC ID overrides never leak to untrusted endpoints.
 */
export const ALLOWED_BASE_HOSTS: ReadonlySet<string> = new Set(['notebooklm.google.com']);

export function getBaseUrl(): string {
  const raw = process.env[ENV_VAR];
  if (!raw) return DEFAULT_BASE_URL;
  // Validate it's a parseable URL with an allowlisted host
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${ENV_VAR} is not a valid URL: ${raw}`);
  }
  if (!ALLOWED_BASE_HOSTS.has(parsed.host)) {
    throw new Error(
      `${ENV_VAR} host '${parsed.host}' is not in the allowlist: ${Array.from(ALLOWED_BASE_HOSTS).join(', ')}`,
    );
  }
  // Strip trailing slash for consistent concatenation
  return raw.replace(/\/$/, '');
}

export function getBaseHost(): string {
  return new URL(getBaseUrl()).host;
}

/**
 * Preferred interface language. Reads `NOTEBOOKLM_HL`; unset/blank falls back
 * to "en". Threaded into the default `language` argument of artifact
 * generation. Mirrors py `_env.get_default_language`.
 */
export function getDefaultLanguage(): string {
  const raw = process.env['NOTEBOOKLM_HL'];
  if (!raw) return 'en';
  const trimmed = raw.trim();
  return trimmed || 'en';
}

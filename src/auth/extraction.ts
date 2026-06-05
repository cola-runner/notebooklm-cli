/**
 * HTML/WIZ field token extraction (CSRF, session ID).
 *
 * NotebookLM (and other Google products) embed a JavaScript object literal
 * named `WIZ_global_data` in the page chrome. Tokens like `SNlM0e` (CSRF) and
 * `FdrFJe` (session ID) live inside that object. This module is the single
 * place that knows how to parse the embedding.
 *
 * Ported from `notebooklm-py/src/notebooklm/_auth/extraction.py`.
 */

import { AuthError } from '../rpc/errors.js';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the ordered list of regex patterns used to locate a WIZ field.
 *
 * Patterns tried in priority order:
 *  1. Canonical double-quoted: `"key":"value"` (or `"key" : "value"`)
 *  2. Single-quoted: `'key':'value'`
 *  3. HTML-escaped: `&quot;key&quot;:&quot;value&quot;`
 *
 * All three tolerate backslash-escaped delimiters inside the value.
 */
function buildWizFieldPatterns(key: string): RegExp[] {
  const k = escapeRegExp(key);
  return [
    new RegExp(`"${k}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`),
    new RegExp(`'${k}'\\s*:\\s*'([^'\\\\]*(?:\\\\.[^'\\\\]*)*)'`),
    new RegExp(`&quot;${k}&quot;\\s*:\\s*&quot;((?:(?!&quot;).)*)&quot;`),
  ];
}

const GOOGLE_AUTH_PATTERNS = [
  /accounts\.google\.com\/(?:ServiceLogin|signin|InteractiveLogin)/i,
  /accounts\.google\.com\/v3\/signin/i,
];

function looksLikeAuthRedirect(text: string): boolean {
  return GOOGLE_AUTH_PATTERNS.some((p) => p.test(text));
}

function safeUrl(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}

export interface ExtractOptions {
  /** If true, throw on missing field. If false, return null. Default: false. */
  strict?: boolean;
}

/**
 * Extract a `WIZ_global_data[key]` value from a NotebookLM HTML response.
 *
 * Empty values pass through verbatim — some Google endpoints legitimately
 * emit empty tokens for unauthenticated probes; callers decide what's
 * acceptable.
 */
export function extractWizField(
  html: string,
  key: string,
  opts: ExtractOptions = {},
): string | null {
  for (const pattern of buildWizFieldPatterns(key)) {
    const match = pattern.exec(html);
    if (match) return match[1] ?? null;
  }
  if (opts.strict) {
    throw new AuthError(`Field '${key}' not found in WIZ_global_data`);
  }
  return null;
}

/** Extract CSRF token (`SNlM0e`) from HTML. Throws if not found. */
export function extractCsrfFromHtml(html: string, finalUrl = ''): string {
  const token = extractWizField(html, 'SNlM0e');
  if (token !== null) return token;
  if (looksLikeAuthRedirect(finalUrl) || looksLikeAuthRedirect(html)) {
    throw new AuthError(
      "Authentication expired or invalid. Run 'notebooklm login' to re-authenticate.",
    );
  }
  throw new AuthError(
    `CSRF token not found in HTML. Final URL: ${safeUrl(finalUrl)}\nThis may indicate the page structure has changed.`,
  );
}

/** Extract session ID (`FdrFJe`) from HTML. Throws if not found. */
export function extractSessionIdFromHtml(html: string, finalUrl = ''): string {
  const sid = extractWizField(html, 'FdrFJe');
  if (sid !== null) return sid;
  if (looksLikeAuthRedirect(finalUrl) || looksLikeAuthRedirect(html)) {
    throw new AuthError(
      "Authentication expired or invalid. Run 'notebooklm login' to re-authenticate.",
    );
  }
  throw new AuthError(
    `Session ID not found in HTML. Final URL: ${safeUrl(finalUrl)}\nThis may indicate the page structure has changed.`,
  );
}

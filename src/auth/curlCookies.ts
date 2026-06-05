/**
 * Parse Google session cookies from a pasted "Copy as cURL" command — or a raw
 * `Cookie:` header / `name=value; …` string — into a `StorageState`.
 *
 * Why this is the recommended login path:
 *  - The only data login needs is the Google cookie set; the CSRF/session
 *    tokens are re-derived from the homepage HTML at runtime (see Session).
 *  - Reusing the cookies from the user's already-signed-in browser sidesteps
 *    both Google's automation block (which kills the Playwright login) and any
 *    OS keychain access (which the Chrome-cookie decrypt path needs and which
 *    nobody will grant to a third-party open-source tool).
 *  - It works on every platform and every browser that ships DevTools.
 *
 * DevTools → Network → right-click a request → "Copy as cURL" yields the full
 * `Cookie:` header, including HttpOnly auth cookies that page JS cannot read.
 */

import type { StorageState, StoredCookie } from './types.js';

export interface ParsedCookie {
  name: string;
  value: string;
}

/**
 * Extract the raw cookie string from a pasted curl command, a `Cookie:` header,
 * or a bare `name=value; …` string.
 *
 * Handles the common "Copy as cURL" dialects:
 *  - bash single-quote:  `-H 'cookie: …'`
 *  - bash ANSI-C quote:  `-H $'cookie: …'`
 *  - double-quote:       `-H "cookie: …"`
 *  - cmd.exe:            `-H ^"cookie: …^"` (carets stripped first)
 *  - explicit jar flags: `-b '…'` / `--cookie '…'`
 */
export function extractCookieString(input: string): string {
  let text = input
    // Collapse shell line-continuations so a multi-line paste becomes one line.
    .replace(/\\\r?\n/g, ' ')
    .replace(/\^\r?\n/g, ' ')
    .replace(/\r?\n/g, ' ')
    .trim();

  // cmd.exe "Copy as cURL" wraps args in ^"…^" and escapes specials with ^.
  // Carets never appear in cookie values or URLs, so stripping them is safe and
  // turns the cmd dialect into the plain double-quote form below.
  if (text.includes('^"')) {
    text = text.replace(/\^/g, '');
  }

  // 1) -H 'cookie: …' / -H $'cookie: …' / -H "cookie: …"
  const headerForms = [/-H\s+\$?'cookie:\s*([^']*)'/i, /-H\s+"cookie:\s*([^"]*)"/i];
  for (const re of headerForms) {
    const m = text.match(re);
    if (m?.[1]) return m[1].trim();
  }

  // 2) -b '…' / --cookie '…' (curl's cookie-jar flags)
  const jarForms = [/(?:-b|--cookie)\s+\$?'([^']*)'/i, /(?:-b|--cookie)\s+"([^"]*)"/i];
  for (const re of jarForms) {
    const m = text.match(re);
    if (m?.[1]) return m[1].trim();
  }

  // 3) Bare paste: a "Cookie: a=1; b=2" header or just "a=1; b=2".
  return text.replace(/^cookie:\s*/i, '').trim();
}

/** Split a `a=1; b=2` cookie string into name/value pairs (split on first `=`). */
export function parseCookiePairs(cookieString: string): ParsedCookie[] {
  const out: ParsedCookie[] = [];
  for (const part of cookieString.split(';')) {
    const seg = part.trim();
    if (!seg) continue;
    const eq = seg.indexOf('=');
    if (eq <= 0) continue; // no '=' or empty name
    const name = seg.slice(0, eq).trim();
    const value = seg.slice(eq + 1).trim();
    if (!name) continue;
    out.push({ name, value });
  }
  return out;
}

/** Parse a curl command / header / bare string straight into cookie pairs. */
export function parseCurlCookies(input: string): ParsedCookie[] {
  return parseCookiePairs(extractCookieString(input));
}

/**
 * Build a `StorageState` from parsed cookie pairs.
 *
 * A header paste loses per-cookie domain/path/expiry metadata, so every cookie
 * is scoped to `.google.com` / path `/` / secure. That is all the outbound
 * request builder needs — it filters cookies by host when composing the
 * `Cookie:` header, and `.google.com` matches every Google host we talk to.
 */
export function cookiesToStorageState(pairs: ParsedCookie[]): StorageState {
  const cookies: StoredCookie[] = pairs.map((p) => ({
    name: p.name,
    value: p.value,
    domain: '.google.com',
    path: '/',
    secure: true,
    httpOnly: true,
  }));
  return { cookies, origins: [] };
}

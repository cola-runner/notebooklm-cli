/**
 * HTTP transport layer — wraps undici with cookie persistence + retry.
 *
 * Concerns:
 *  - Send POST / GET with browser-like headers
 *  - Persist Set-Cookie responses back into the in-memory storage state
 *  - Drive retries with exponential backoff + Retry-After honoring
 *  - Trigger keepalive `RotateCookies` poke before each authed call
 *
 * Ported (simplified for v0.1) from `notebooklm-py/src/notebooklm/_authed_transport.py`.
 */

import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { CookieJar } from 'tough-cookie';
import { request } from 'undici';
import { buildCookieHeader, homepageHeaders, rotateCookies, rpcHeaders } from '../auth/index.js';
import type { StorageState, StoredCookie } from '../auth/types.js';
import { getBaseUrl } from '../env.js';
import { AuthError, NetworkError, RPCError, RateLimitError, ServerError } from '../rpc/errors.js';
import { computeBackoffMs, parseRetryAfter } from './backoff.js';

const MAX_RETRIES = 3;

/** Download URLs must resolve to one of these Google-owned domains. */
const TRUSTED_DOWNLOAD_DOMAINS = ['.google.com', '.googleusercontent.com', '.googleapis.com'];

function isTrustedDownloadHost(host: string): boolean {
  return TRUSTED_DOWNLOAD_DOMAINS.some(
    (domain) => host === domain.replace(/^\./, '') || host.endsWith(domain),
  );
}

export interface TransportOptions {
  /** Where storage_state.json lives — used as rotation rate-limit key. */
  storagePath: string;
  /** Mutable in-memory cookie state, kept in sync with set-cookie responses. */
  state: StorageState;
  /** Disable the keepalive `RotateCookies` poke before each call. */
  disableKeepalive?: boolean;
}

export class Transport {
  readonly storagePath: string;
  readonly state: StorageState;
  readonly disableKeepalive: boolean;

  constructor(opts: TransportOptions) {
    this.storagePath = opts.storagePath;
    this.state = opts.state;
    this.disableKeepalive = opts.disableKeepalive ?? false;
  }

  /** Build a cookie header for the configured base host. */
  cookieHeader(): string {
    const host = new URL(getBaseUrl()).host;
    return buildCookieHeader(this.state, host);
  }

  /** Build a cookie header scoped to an arbitrary download host. */
  private cookieHeaderFor(host: string): string {
    return buildCookieHeader(this.state, host);
  }

  /** Seed a tough-cookie jar from the in-memory cookie state. */
  private buildCookieJar(): CookieJar {
    const jar = new CookieJar();
    for (const c of this.state.cookies) {
      const host = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
      const seedUrl = `https://${host}${c.path || '/'}`;
      const attrs = [`${c.name}=${c.value}`, `Domain=${c.domain}`, `Path=${c.path || '/'}`];
      if (c.secure) attrs.push('Secure');
      try {
        jar.setCookieSync(attrs.join('; '), seedUrl, { ignoreError: true });
      } catch {
        // Skip cookies tough-cookie rejects (e.g. malformed domain).
      }
    }
    return jar;
  }

  /**
   * Stream a media artifact to `outputPath`. Follows the signed-URL redirect
   * chain (lh3.googleusercontent.com → lh3.google.com/rd-notebooklm/…) using a
   * proper per-domain cookie jar that carries Set-Cookie forward across hops —
   * the auth handshake loops forever without it. Validates HTTPS + trusted
   * Google domains, rejects HTML/empty bodies, writes atomically.
   */
  async download(url: string, outputPath: string): Promise<string> {
    const debug = process.env['NOTEBOOKLM_DEBUG'] === '1';
    const jar = this.buildCookieJar();
    const maxHops = 20;
    let current = url;
    let res: Awaited<ReturnType<typeof request>> | undefined;

    for (let hop = 0; hop < maxHops; hop++) {
      const parsed = new URL(current);
      if (parsed.protocol !== 'https:') {
        throw new NetworkError(`Download URL must use HTTPS: ${current.slice(0, 80)}`);
      }
      if (!isTrustedDownloadHost(parsed.host)) {
        throw new NetworkError(`Untrusted download domain: ${parsed.host}`);
      }

      const cookie = await jar.getCookieString(current);
      const headers: Record<string, string> = { ...homepageHeaders() };
      if (cookie) headers['Cookie'] = cookie;

      res = await request(current, { method: 'GET', headers });

      const setCookie = res.headers['set-cookie'];
      if (setCookie) {
        for (const line of Array.isArray(setCookie) ? setCookie : [setCookie]) {
          try {
            await jar.setCookie(line, current);
          } catch {
            // Ignore cookies the jar rejects for this URL.
          }
        }
      }
      if (debug) {
        const n = Array.isArray(setCookie) ? setCookie.length : setCookie ? 1 : 0;
        console.error(`[download] hop ${hop}: ${res.statusCode} ${parsed.host} (set-cookie x${n})`);
      }

      if (res.statusCode >= 300 && res.statusCode < 400) {
        const loc = res.headers['location'];
        const location = Array.isArray(loc) ? loc[0] : loc;
        if (!location) break;
        await res.body.text();
        current = new URL(location, current).toString();
        continue;
      }
      break;
    }

    if (!res) throw new NetworkError('Download produced no response');
    const finalHost = new URL(current).host;

    if (res.statusCode === 401 || res.statusCode === 403) {
      await res.body.text();
      throw new AuthError(
        `Authentication required for ${finalHost} — re-import your session ('notebooklm import-chrome').`,
      );
    }
    if (res.statusCode >= 400) {
      await res.body.text();
      throw new NetworkError(`Download failed (HTTP ${res.statusCode}) for ${finalHost}`);
    }

    const contentType = res.headers['content-type'];
    const ct = Array.isArray(contentType) ? contentType[0] : contentType;
    if (ct?.includes('text/html')) {
      await res.body.text();
      throw new NetworkError(
        'Download returned HTML instead of media — auth may have expired. Run "notebooklm import-chrome".',
      );
    }

    await mkdir(dirname(outputPath), { recursive: true });
    const tempPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await pipeline(res.body, createWriteStream(tempPath));
      await rename(tempPath, outputPath);
    } catch (err) {
      await rm(tempPath, { force: true });
      throw err instanceof Error ? err : new NetworkError(String(err));
    }
    return outputPath;
  }

  /** Apply any Set-Cookie responses into our in-memory state. */
  private applySetCookies(raw: string | string[] | undefined): void {
    if (!raw) return;
    const headers = Array.isArray(raw) ? raw : [raw];
    for (const line of headers) {
      const parsed = parseSetCookie(line);
      if (!parsed) continue;
      const existingIndex = this.state.cookies.findIndex(
        (c) => c.name === parsed.name && c.domain === parsed.domain && c.path === parsed.path,
      );
      if (existingIndex >= 0) {
        this.state.cookies[existingIndex] = parsed;
      } else {
        this.state.cookies.push(parsed);
      }
    }
  }

  /**
   * GET with manual redirect following (max 10 hops). Captures Set-Cookie
   * on every hop so the rotated cookies persist across redirects.
   */
  private async requestWithRedirects(
    initialUrl: string,
    init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string },
    maxHops = 10,
  ): Promise<Awaited<ReturnType<typeof request>>> {
    const debug = process.env['NOTEBOOKLM_DEBUG'] === '1';
    let url = initialUrl;
    for (let hop = 0; hop < maxHops; hop++) {
      const res = await request(url, init);
      this.applySetCookies(res.headers['set-cookie']);
      if (debug) {
        const setCookie = res.headers['set-cookie'];
        const n = Array.isArray(setCookie) ? setCookie.length : setCookie ? 1 : 0;
        console.error(`[redirect] hop ${hop}: ${res.statusCode} ${url} (set-cookie x${n})`);
      }
      if (res.statusCode >= 300 && res.statusCode < 400) {
        const loc = res.headers['location'];
        const location = Array.isArray(loc) ? loc[0] : loc;
        if (!location) return res;
        await res.body.text();
        url = new URL(location, url).toString();
        // Send cookies scoped to the *hop's* host. A homepage → /login →
        // accounts.google.com/ServiceLogin bounce needs the accounts.google.com
        // cookies (not notebooklm's) to complete the passive re-auth that mints
        // the service OSID; sending the wrong host's cookies loops forever.
        init.headers['Cookie'] = this.cookieHeaderFor(new URL(url).host);
        continue;
      }
      return res;
    }
    throw new NetworkError(`Too many redirects (>${maxHops})`);
  }

  /** Best-effort keepalive — does NOT throw on failure. */
  private async maybeRotate(): Promise<void> {
    if (this.disableKeepalive) return;
    const result = await rotateCookies({
      cookieHeader: this.cookieHeader(),
      storagePath: this.storagePath,
    });
    this.applySetCookies(result.setCookies);
  }

  /** GET the homepage HTML (for CSRF/session id extraction). */
  async getHomepage(): Promise<{ html: string; finalUrl: string }> {
    await this.maybeRotate();
    const url = `${getBaseUrl()}/`;
    const res = await this.requestWithRedirects(url, {
      method: 'GET',
      headers: {
        ...homepageHeaders(),
        Cookie: this.cookieHeader(),
      },
    });
    this.applySetCookies(res.headers['set-cookie']);
    const html = await res.body.text();
    if (res.statusCode >= 400) {
      throw new NetworkError(`Homepage GET returned ${res.statusCode}`, { rawResponse: html });
    }
    return { html, finalUrl: url };
  }

  /**
   * POST a batchexecute RPC request. Returns the raw response text.
   *
   * Handles retries for 429 / 5xx with exponential backoff; throws typed
   * errors for 401/403 (AuthError), 4xx (ClientError), 5xx (ServerError).
   */
  async postRpc(url: string, body: string): Promise<string> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.maybeRotate();
        const res = await request(url, {
          method: 'POST',
          headers: {
            ...rpcHeaders(),
            Cookie: this.cookieHeader(),
          },
          body,
        });
        this.applySetCookies(res.headers['set-cookie']);
        const text = await res.body.text();

        if (res.statusCode === 401 || res.statusCode === 403) {
          throw new AuthError(`Authentication failed (HTTP ${res.statusCode}).`, {
            rawResponse: text,
          });
        }
        if (res.statusCode === 429) {
          const retryAfter = parseRetryAfter(res.headers['retry-after']);
          throw new RateLimitError(`Rate limited (HTTP 429). retry-after=${retryAfter ?? '?'}s`, {
            rawResponse: text,
          });
        }
        if (res.statusCode >= 500) {
          throw new ServerError(`Server error (HTTP ${res.statusCode})`, {
            rawResponse: text,
          });
        }
        if (res.statusCode >= 400) {
          throw new RPCError(`HTTP ${res.statusCode}`, { rawResponse: text });
        }
        return text;
      } catch (err) {
        lastErr = err;
        const retryable = err instanceof RateLimitError || err instanceof ServerError;
        if (!retryable || attempt === MAX_RETRIES) throw err;
        let delayMs = computeBackoffMs(attempt);
        if (err instanceof RateLimitError && err.message.includes('retry-after=')) {
          const match = /retry-after=(\d+)s/.exec(err.message);
          if (match?.[1]) delayMs = Math.max(delayMs, Number(match[1]) * 1000);
        }
        await sleep(delayMs);
      }
    }
    throw lastErr;
  }
}

/**
 * Minimal Set-Cookie parser. We only need name/value/domain/path/expires —
 * the cookie's effective use is via the `Cookie:` header we synthesize, so
 * we don't need to enforce RFC 6265 in full.
 */
function parseSetCookie(line: string): StoredCookie | null {
  const parts = line.split(';').map((s) => s.trim());
  const first = parts[0];
  if (!first || !first.includes('=')) return null;
  const eq = first.indexOf('=');
  const name = first.slice(0, eq);
  const value = first.slice(eq + 1);
  const cookie: StoredCookie = {
    name,
    value,
    domain: '.google.com',
    path: '/',
  };
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const [k, v] = part.split('=', 2);
    if (!k) continue;
    const key = k.toLowerCase();
    if (key === 'domain' && v) cookie.domain = v;
    else if (key === 'path' && v) cookie.path = v;
    else if (key === 'expires' && v) {
      const t = new Date(v).getTime();
      if (!Number.isNaN(t)) cookie.expires = Math.floor(t / 1000);
    } else if (key === 'max-age' && v) {
      const seconds = Number(v);
      if (Number.isFinite(seconds)) cookie.expires = Math.floor(Date.now() / 1000) + seconds;
    } else if (key === 'secure') cookie.secure = true;
    else if (key === 'httponly') cookie.httpOnly = true;
    else if (key === 'samesite' && v) {
      const normalized = v[0]?.toUpperCase() + v.slice(1).toLowerCase();
      if (normalized === 'Strict' || normalized === 'Lax' || normalized === 'None') {
        cookie.sameSite = normalized;
      }
    }
  }
  return cookie;
}

/**
 * HTTP header construction for browser-like requests.
 *
 * Using a real Chromium User-Agent is mandatory: with the default `undici`
 * UA, Google returns a simplified HTML response that omits the
 * `WIZ_global_data` block we need for token extraction.
 */

import { getBaseUrl } from '../env.js';

export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

/** Default headers attached to every authenticated Gemini Notebook request. */
export function baseHeaders(): Record<string, string> {
  const baseUrl = getBaseUrl();
  return {
    'User-Agent': BROWSER_USER_AGENT,
    Origin: baseUrl,
    Referer: `${baseUrl}/`,
    'Accept-Language': 'en-US,en;q=0.9',
  };
}

/** Headers for batchexecute RPC POST. */
export function rpcHeaders(): Record<string, string> {
  return {
    ...baseHeaders(),
    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    'X-Same-Domain': '1',
  };
}

/** Headers for the home-page GET (used to refresh CSRF + session id). */
export function homepageHeaders(): Record<string, string> {
  return {
    ...baseHeaders(),
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,' + 'image/avif,image/webp,*/*;q=0.8',
  };
}

/**
 * Route undici through an HTTP(S) proxy when one is configured in the
 * environment.
 *
 * Unlike curl, undici does NOT honor `http_proxy` / `https_proxy` env vars
 * automatically — without this, requests go direct and hang in networks that
 * require a proxy to reach Google. SOCKS proxies (`ALL_PROXY=socks5://…`) are
 * skipped because undici's ProxyAgent only speaks HTTP CONNECT tunneling.
 */

import { Agent, ProxyAgent, setGlobalDispatcher } from 'undici';

// Google replies with many (and large) Set-Cookie headers — especially when a
// session carries 100+ cookies — which overflows undici's 16 KiB default.
const MAX_HEADER_SIZE = 1 << 18; // 256 KiB

let configured = false;

/**
 * Configure the global undici dispatcher once per process: route through an
 * HTTP(S) proxy if one is set in the environment, and raise `maxHeaderSize` so
 * large Set-Cookie responses don't trigger HeadersOverflowError.
 *
 * Returns the proxy URL applied, or undefined if none was used.
 */
export function configureProxyFromEnv(): string | undefined {
  if (configured) return undefined;
  configured = true;
  const proxy =
    process.env['HTTPS_PROXY'] ||
    process.env['https_proxy'] ||
    process.env['HTTP_PROXY'] ||
    process.env['http_proxy'];
  if (proxy && !proxy.startsWith('socks')) {
    setGlobalDispatcher(new ProxyAgent({ uri: proxy, maxHeaderSize: MAX_HEADER_SIZE }));
    return proxy;
  }
  // No usable proxy — still raise the header limit for direct connections.
  setGlobalDispatcher(new Agent({ maxHeaderSize: MAX_HEADER_SIZE }));
  return undefined;
}

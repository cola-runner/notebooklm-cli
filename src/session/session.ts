/**
 * Session orchestration — token cache, RPC dispatch, lifecycle.
 *
 * Owns:
 *  - The `Transport` instance
 *  - Cached `AuthTokens` (CSRF + session ID), refreshed lazily
 *  - The RPC dispatch entry point used by feature APIs
 *
 * Ported (simplified for v0.1) from `notebooklm-py/src/notebooklm/_session.py`
 * + `_rpc_executor.py` + `_session_auth.py`.
 */

import { extractCsrfFromHtml, extractSessionIdFromHtml } from '../auth/extraction.js';
import { saveStorageState } from '../auth/storage.js';
import type { AuthTokens, StorageState } from '../auth/types.js';
import { AuthError } from '../rpc/errors.js';
import {
  RPCMethod,
  type RPCMethodId,
  type RPCMethodName,
  buildRequestBody,
  decodeResponse,
  encodeRpcRequest,
  getBatchexecuteUrl,
  resolveRpcId,
} from '../rpc/index.js';
import { Transport } from './transport.js';

/** Tokens are refreshed if older than this many ms. */
const TOKEN_TTL_MS = 25 * 60 * 1000; // 25 minutes — conservative vs Google's window

export interface SessionOptions {
  storagePath: string;
  state: StorageState;
  /** Skip the keepalive `RotateCookies` poke before each call. */
  disableKeepalive?: boolean;
}

export interface RpcCallOptions {
  /** If true, return null instead of throwing on null result. */
  allowNull?: boolean;
  /** Override the `source-path` query param (defaults to `/`). Some RPCs —
   * e.g. ADD_SOURCE_FILE — must be scoped to `/notebook/<id>`. */
  sourcePath?: string;
}

export class Session {
  readonly transport: Transport;
  private tokens: AuthTokens | null = null;
  private refreshInflight: Promise<AuthTokens> | null = null;

  constructor(opts: SessionOptions) {
    const transportOpts: ConstructorParameters<typeof Transport>[0] = {
      storagePath: opts.storagePath,
      state: opts.state,
    };
    if (opts.disableKeepalive !== undefined) {
      transportOpts.disableKeepalive = opts.disableKeepalive;
    }
    this.transport = new Transport(transportOpts);
  }

  private tokensFresh(): boolean {
    if (!this.tokens) return false;
    return Date.now() - this.tokens.extractedAt < TOKEN_TTL_MS;
  }

  /** Force-refresh the CSRF + session ID by fetching the homepage. */
  async refreshTokens(): Promise<AuthTokens> {
    if (this.refreshInflight) return this.refreshInflight;
    this.refreshInflight = (async () => {
      const { html, finalUrl } = await this.transport.getHomepage();
      const csrf = extractCsrfFromHtml(html, finalUrl);
      const sessionId = extractSessionIdFromHtml(html, finalUrl);
      this.tokens = { csrf, sessionId, extractedAt: Date.now() };
      return this.tokens;
    })();
    try {
      return await this.refreshInflight;
    } finally {
      this.refreshInflight = null;
    }
  }

  /** Get cached tokens or refresh if missing/stale. Public so chat can reuse. */
  async ensureTokens(): Promise<AuthTokens> {
    if (this.tokensFresh()) return this.tokens!;
    return this.refreshTokens();
  }

  /** Persist current cookie state to disk. */
  async saveStorage(): Promise<void> {
    await saveStorageState(this.transport.storagePath, this.transport.state);
  }

  /**
   * Execute an RPC call. Handles token refresh on AuthError (one retry).
   */
  async call<T = unknown>(
    methodName: RPCMethodName,
    params: unknown[],
    opts: RpcCallOptions = {},
  ): Promise<T> {
    const methodId = RPCMethod[methodName] as RPCMethodId;
    return this.callRaw<T>(methodName, methodId, params, opts);
  }

  private async callRaw<T>(
    methodName: RPCMethodName,
    methodId: RPCMethodId | string,
    params: unknown[],
    opts: RpcCallOptions,
    didRefresh = false,
  ): Promise<T> {
    const tokens = await this.ensureTokens();
    const resolvedId = resolveRpcId(methodName, methodId);
    const encoded = encodeRpcRequest(resolvedId, params, resolvedId);
    const body = buildRequestBody(encoded, tokens.csrf);
    const url = new URL(getBatchexecuteUrl());
    url.searchParams.set('rpcids', resolvedId);
    url.searchParams.set('source-path', opts.sourcePath ?? '/');
    url.searchParams.set('f.sid', tokens.sessionId);
    url.searchParams.set('bl', 'boq_labs-tailwind-frontend_20250101.00_p0');
    url.searchParams.set('hl', 'en');
    url.searchParams.set('_reqid', String(Math.floor(Math.random() * 9_000_000) + 1_000_000));
    url.searchParams.set('rt', 'c');

    try {
      const raw = await this.transport.postRpc(url.toString(), body);
      return decodeResponse(raw, resolvedId, opts) as T;
    } catch (err) {
      if (err instanceof AuthError && !didRefresh) {
        this.tokens = null; // Force re-extract on next call
        return this.callRaw<T>(methodName, methodId, params, opts, true);
      }
      throw err;
    }
  }
}

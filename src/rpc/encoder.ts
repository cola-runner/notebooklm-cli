/**
 * Encode RPC requests for the NotebookLM batchexecute API.
 *
 * Ported from `notebooklm-py/src/notebooklm/rpc/encoder.py`. The wire format
 * is a triple-nested JSON array `[[[rpc_id, json_params, null, "generic"]]]`
 * URL-encoded into the `f.req` form field.
 */

import type { RPCMethodId } from './types.js';

/** Encoded inner block — keep loose so callers can pass arbitrary param shapes. */
export type EncodedRPCRequest = [[[RPCMethodId | string, string, null, 'generic']]];

/**
 * Encode an RPC request into batchexecute format.
 *
 * @param methodId Canonical RPC id (e.g. `'wXbhsf'`)
 * @param params   Parameters for the RPC call — anything JSON-serializable
 * @param rpcIdOverride Optional resolved override (callers must pass the same
 *   string to the URL builder so `rpcids=` and `f.req` body stay in sync)
 */
export function encodeRpcRequest(
  methodId: RPCMethodId | string,
  params: unknown[],
  rpcIdOverride?: string,
): EncodedRPCRequest {
  const rpcId = rpcIdOverride ?? methodId;
  // JSON-encode params without spaces (compact format matching Chrome)
  const paramsJson = JSON.stringify(params);
  return [[[rpcId, paramsJson, null, 'generic']]];
}

/**
 * Wrap each source ID in `depth` inner lists, then collect.
 *
 * - depth=1: `[[id1], [id2]]`
 * - depth=2: `[[[id1]], [[id2]]]`
 * - depth=3: `[[[[id1]]], [[[id2]]]]`
 */
export function nestSourceIds(ids: string[] | null | undefined, depth: number): unknown[] {
  if (depth < 1) {
    throw new RangeError(`depth must be >= 1, got ${depth}`);
  }
  if (!ids || ids.length === 0) return [];
  let result: unknown[] = [...ids];
  for (let i = 0; i < depth; i++) {
    result = result.map((item) => [item]);
  }
  return result;
}

/**
 * Build the form-encoded request body for batchexecute.
 *
 * Output format: `f.req=<URL-encoded triple-nested JSON>&at=<csrf_token>&`
 * (trailing `&` matches the live wire format).
 */
export function buildRequestBody(rpcRequest: EncodedRPCRequest, csrfToken?: string): string {
  const fReq = JSON.stringify(rpcRequest);
  const parts = [`f.req=${encodeURIComponent(fReq)}`];
  if (csrfToken) {
    parts.push(`at=${encodeURIComponent(csrfToken)}`);
  }
  // Join with & and add trailing & (matches Chrome's wire format)
  return `${parts.join('&')}&`;
}

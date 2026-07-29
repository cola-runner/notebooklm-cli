/**
 * Decode RPC responses from the Gemini Notebook batchexecute API.
 *
 * Ported from `notebooklm-py/src/notebooklm/rpc/decoder.py`. The response
 * format is:
 *
 *   1. `)]}',\n` anti-XSSI prefix
 *   2. Alternating lines of `<byte_count>` and `<json_payload>` chunks
 *   3. Each chunk contains either `["wrb.fr", rpc_id, result_data, ...]`
 *      or `["er", rpc_id, error_code, ...]` items.
 */

import {
  ClientError,
  RPCError,
  RateLimitError,
  UnknownRPCMethodError,
  truncateResponsePreview,
} from './errors.js';
import { safeIndex } from './safeIndex.js';

// =====================================================================
// Error code tables
// =====================================================================

export const RPCErrorCode = {
  UNKNOWN: 0,
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
} as const;

const GRPC_STATUS_MESSAGES: Record<number, string> = {
  0: 'OK',
  1: 'Cancelled',
  2: 'Unknown',
  3: 'Invalid argument',
  4: 'Deadline exceeded',
  5: 'Not found',
  6: 'Already exists',
  7: 'Permission denied',
  8: 'Resource exhausted',
  9: 'Failed precondition',
  10: 'Aborted',
  11: 'Out of range',
  12: 'Not implemented',
  13: 'Internal',
  14: 'Unavailable',
  15: 'Data loss',
  16: 'Unauthenticated',
};

const ACCOUNT_MISMATCH_HINT =
  ' If you have multiple Google accounts signed in, this is commonly an ' +
  'account-routing mismatch — the request defaults to account index 0 when ' +
  'no authuser is set.';

const ERROR_CODE_MESSAGES: Record<number, [string, boolean]> = {
  [RPCErrorCode.INVALID_REQUEST]: [
    'Invalid request parameters. Check your input and try again.',
    false,
  ],
  [RPCErrorCode.UNAUTHORIZED]: [
    "Authentication required. Run 'gemini-notebook login' to re-authenticate.",
    false,
  ],
  [RPCErrorCode.FORBIDDEN]: ['Insufficient permissions for this operation.', false],
  [RPCErrorCode.NOT_FOUND]: ['Requested resource not found.', false],
  [RPCErrorCode.RATE_LIMITED]: ['API rate limit exceeded. Please wait before retrying.', true],
  [RPCErrorCode.SERVER_ERROR]: [
    'Server error occurred. This is usually temporary - try again later.',
    true,
  ],
};

export function getErrorMessageForCode(code: number | undefined): [string, boolean] {
  if (code == null) return ['Unknown error occurred.', false];
  const known = ERROR_CODE_MESSAGES[code];
  if (known) return known;
  if (code >= 400 && code < 500) {
    return [`Client error ${code}. Check your request parameters.`, false];
  }
  if (code >= 500 && code < 600) {
    return [`Server error ${code}. This is usually temporary - try again later.`, true];
  }
  return [`Error code: ${code}`, false];
}

// =====================================================================
// Anti-XSSI prefix stripping
// =====================================================================

/**
 * Remove anti-XSSI prefix `)]}',\n` (or `)]}',\r\n` on Windows) from a response.
 */
export function stripAntiXssi(response: string): string {
  if (!response.startsWith(")]}'")) return response;
  const match = /^\)\]\}'\r?\n/.exec(response);
  if (!match) return response;
  return response.slice(match[0].length);
}

// =====================================================================
// Chunked response parsing
// =====================================================================

export function parseChunkedResponse(response: string): unknown[] {
  if (!response || !response.trim()) return [];

  const chunks: unknown[] = [];
  let skipped = 0;
  let totalRecords = 0;
  const lines = response
    .trim()
    .split('\n')
    .map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));

  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i] ?? '';
    const line = rawLine.trim();
    if (!line) {
      i++;
      continue;
    }

    // Try to parse as byte count (integer)
    const asInt = Number(line);
    const looksLikeByteCount = /^-?\d+$/.test(line) && Number.isFinite(asInt);

    if (looksLikeByteCount) {
      totalRecords++;
      i++;
      if (i >= lines.length) {
        skipped++;
        continue;
      }
      const jsonStr = lines[i] ?? '';
      try {
        chunks.push(JSON.parse(jsonStr));
      } catch {
        skipped++;
      }
      i++;
    } else {
      // Not a byte count — try as JSON directly
      totalRecords++;
      try {
        chunks.push(JSON.parse(line));
      } catch {
        skipped++;
      }
      i++;
    }
  }

  if (skipped > 0) {
    const errorRate = totalRecords > 0 ? skipped / totalRecords : 0;
    if (errorRate > 0.1) {
      throw new RPCError(
        `Response parsing failed: ${skipped} of ${totalRecords} response records malformed. This may indicate API changes or data corruption.`,
        { rawResponse: response },
      );
    }
  }

  return chunks;
}

// =====================================================================
// RPC result extraction
// =====================================================================

export function collectRpcIds(chunks: unknown[]): string[] {
  const found: string[] = [];
  const source = 'decoder.collectRpcIds';
  for (const chunk of chunks) {
    if (!Array.isArray(chunk) || chunk.length === 0) continue;
    const first = safeIndex(chunk, 0, undefined, source);
    const items = Array.isArray(first) ? chunk : [chunk];
    for (const item of items) {
      if (!Array.isArray(item) || item.length < 2) continue;
      const tag = safeIndex(item, 0, undefined, source);
      const rpcId = safeIndex(item, 1, undefined, source);
      if ((tag === 'wrb.fr' || tag === 'er') && typeof rpcId === 'string') {
        found.push(rpcId);
      }
    }
  }
  return found;
}

function containsUserDisplayableError(obj: unknown): boolean {
  if (typeof obj === 'string') return obj.includes('UserDisplayableError');
  if (Array.isArray(obj)) return obj.some(containsUserDisplayableError);
  if (obj && typeof obj === 'object') {
    return Object.values(obj as Record<string, unknown>).some(containsUserDisplayableError);
  }
  return false;
}

function extractStatusCode(errorInfo: unknown): [number, string] | null {
  if (!Array.isArray(errorInfo) || errorInfo.length !== 1) return null;
  const code = errorInfo[0];
  if (typeof code !== 'number' || !Number.isInteger(code)) return null;
  const label = GRPC_STATUS_MESSAGES[code];
  if (label === undefined) return null;
  return [code, label];
}

function findWrbStatus(chunks: unknown[], rpcId: string): [number, string] | null {
  const source = 'decoder.findWrbStatus';
  for (const chunk of chunks) {
    if (!Array.isArray(chunk) || chunk.length === 0) continue;
    const first = safeIndex(chunk, 0, rpcId, source);
    const items = Array.isArray(first) ? chunk : [chunk];
    for (const item of items) {
      if (!Array.isArray(item) || item.length < 6) continue;
      const tag = safeIndex(item, 0, rpcId, source);
      const idField = safeIndex(item, 1, rpcId, source);
      if (tag !== 'wrb.fr' || idField !== rpcId) continue;
      const resultData = safeIndex(item, 2, rpcId, source);
      const errorInfo = safeIndex(item, 5, rpcId, source);
      if (resultData != null || errorInfo == null) continue;
      const status = extractStatusCode(errorInfo);
      if (status) return status;
    }
  }
  return null;
}

export function extractRpcResult(chunks: unknown[], rpcId: string): unknown {
  const source = 'decoder.extractRpcResult';
  for (const chunk of chunks) {
    if (!Array.isArray(chunk) || chunk.length === 0) continue;
    const first = safeIndex(chunk, 0, rpcId, source);
    const items = Array.isArray(first) ? chunk : [chunk];

    for (const item of items) {
      if (!Array.isArray(item) || item.length < 3) continue;
      const tag = safeIndex(item, 0, rpcId, source);
      const idField = safeIndex(item, 1, rpcId, source);

      if (tag === 'er' && idField === rpcId) {
        const errorCode = safeIndex(item, 2, rpcId, source);
        let errorMsg: string;
        if (typeof errorCode === 'number') {
          errorMsg = getErrorMessageForCode(errorCode)[0];
        } else {
          errorMsg = errorCode ? String(errorCode) : 'Unknown error';
        }
        const opts: { methodId: string; rpcCode?: number | string } = { methodId: rpcId };
        if (typeof errorCode === 'number' || typeof errorCode === 'string') {
          opts.rpcCode = errorCode;
        }
        throw new RPCError(errorMsg, opts);
      }

      if (tag === 'wrb.fr' && idField === rpcId) {
        const resultData = safeIndex(item, 2, rpcId, source);
        if (resultData == null && item.length > 5) {
          const errorInfo = safeIndex(item, 5, rpcId, source);
          if (errorInfo != null && containsUserDisplayableError(errorInfo)) {
            throw new RateLimitError(
              'API rate limit or quota exceeded. Please wait before retrying.',
              { methodId: rpcId, rpcCode: 'USER_DISPLAYABLE_ERROR' },
            );
          }
        }
        if (typeof resultData === 'string') {
          try {
            return JSON.parse(resultData);
          } catch {
            return resultData;
          }
        }
        return resultData;
      }
    }
  }
  return null;
}

// =====================================================================
// Full decode pipeline
// =====================================================================

export interface DecodeOptions {
  /** If `true`, return `null` instead of throwing when result is null. */
  allowNull?: boolean;
}

export function decodeResponse(
  rawResponse: string,
  rpcId: string,
  opts: DecodeOptions = {},
): unknown {
  const cleaned = stripAntiXssi(rawResponse);
  const chunks = parseChunkedResponse(cleaned);
  const foundIds = collectRpcIds(chunks);
  const preview = cleaned;

  let result: unknown;
  try {
    result = extractRpcResult(chunks, rpcId);
  } catch (err) {
    if (err instanceof RPCError) {
      if (err.foundIds.length === 0) err.foundIds = foundIds;
      if (!err.rawResponse) err.rawResponse = truncateResponsePreview(preview);
    }
    throw err;
  }

  if (result === null || result === undefined) {
    if (opts.allowNull) return null;

    if (foundIds.length > 0 && !foundIds.includes(rpcId)) {
      throw new UnknownRPCMethodError(
        `No result found for RPC ID '${rpcId}'. Response contains IDs: ${foundIds.join(
          ', ',
        )}. The RPC method ID may have changed.`,
        { methodId: rpcId, foundIds, rawResponse: preview },
      );
    }

    if (foundIds.includes(rpcId)) {
      const status = findWrbStatus(chunks, rpcId);
      if (status) {
        const [code, label] = status;
        const msg = `RPC ${rpcId} returned null result with status code ${code} (${label}).`;
        if (code === 5 || code === 7) {
          throw new ClientError(msg + ACCOUNT_MISMATCH_HINT, {
            methodId: rpcId,
            rpcCode: code,
            foundIds,
            rawResponse: preview,
          });
        }
        throw new RPCError(msg, {
          methodId: rpcId,
          rpcCode: code,
          foundIds,
          rawResponse: preview,
        });
      }
      throw new RPCError(
        `RPC ${rpcId} returned null result data (possible server error or parameter mismatch)`,
        { methodId: rpcId, foundIds, rawResponse: preview },
      );
    }

    throw new RPCError(
      `No result found for RPC ID: ${rpcId} (response contained no RPC data — ${chunks.length} chunks parsed)`,
      { methodId: rpcId, rawResponse: preview },
    );
  }

  return result;
}

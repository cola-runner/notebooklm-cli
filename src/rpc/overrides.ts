/**
 * Runtime RPC ID override policy.
 *
 * Ported from `notebooklm-py/src/notebooklm/rpc/overrides.py`. The
 * `NOTEBOOKLM_RPC_OVERRIDES` env var lets users patch RPC method IDs without
 * waiting for a library release when Google changes them.
 *
 * Example: `NOTEBOOKLM_RPC_OVERRIDES='{"LIST_NOTEBOOKS":"newId123"}'`
 */

import { ALLOWED_BASE_HOSTS, getBaseHost } from '../env.js';
import { RPCMethod, type RPCMethodName } from './types.js';

export const RPC_OVERRIDES_ENV_VAR = 'NOTEBOOKLM_RPC_OVERRIDES';

const validMethodNames = new Set<string>(Object.keys(RPCMethod));
const loggedOverrideHashes = new Set<string>();
const parseCache = new Map<string, Map<string, string>>();

function warn(msg: string): void {
  // eslint-disable-next-line no-console
  console.warn(`[notebooklm-cli] ${msg}`);
}

function info(msg: string): void {
  // eslint-disable-next-line no-console
  console.info(`[notebooklm-cli] ${msg}`);
}

function parseOverrides(raw: string | undefined): Map<string, string> {
  if (!raw) return new Map();
  const cached = parseCache.get(raw);
  if (cached) return cached;

  const result = new Map<string, string>();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (exc) {
    warn(`${RPC_OVERRIDES_ENV_VAR} is not valid JSON: ${(exc as Error).message}`);
    parseCache.set(raw, result);
    return result;
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    warn(
      `${RPC_OVERRIDES_ENV_VAR} must be a JSON object mapping method names to RPC IDs, got ${
        Array.isArray(data) ? 'array' : typeof data
      }`,
    );
    parseCache.set(raw, result);
    return result;
  }

  const nullKeys: string[] = [];
  const unknownKeys: string[] = [];

  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (v == null) {
      nullKeys.push(k);
      continue;
    }
    if (!validMethodNames.has(k)) {
      unknownKeys.push(k);
      continue;
    }
    result.set(k, String(v));
  }

  if (nullKeys.length > 0) {
    warn(
      `Ignoring ${RPC_OVERRIDES_ENV_VAR} entries with null values (provide a non-null RPC id string): ${nullKeys
        .sort()
        .join(', ')}`,
    );
  }
  if (unknownKeys.length > 0) {
    warn(
      `Ignoring unknown ${RPC_OVERRIDES_ENV_VAR} method names (not in RPCMethod): ${unknownKeys
        .sort()
        .join(', ')}`,
    );
  }
  parseCache.set(raw, result);
  return result;
}

function loadOverrides(): Map<string, string> {
  return parseOverrides(process.env[RPC_OVERRIDES_ENV_VAR]);
}

/**
 * Return the override RPC id for `methodName` when applicable, else `canonicalId`.
 *
 * Overrides are gated on the configured base host being on the allowlist
 * (defense in depth — `getBaseUrl()` already validates this, but we re-check
 * here so custom RPC IDs never leak to untrusted endpoints).
 *
 * First-use of a distinct override set logs INFO so operators can confirm the
 * config they intended is live; subsequent calls with the same set are silent.
 */
export function resolveRpcId(methodName: RPCMethodName, canonicalId: string): string {
  let host: string;
  try {
    host = getBaseHost();
  } catch {
    return canonicalId;
  }
  if (!ALLOWED_BASE_HOSTS.has(host)) return canonicalId;

  const overrides = loadOverrides();
  if (overrides.size === 0) return canonicalId;

  const sortedKey = [...overrides.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  if (!loggedOverrideHashes.has(sortedKey)) {
    loggedOverrideHashes.add(sortedKey);
    info(`${RPC_OVERRIDES_ENV_VAR} applied: ${sortedKey}`);
  }

  return overrides.get(methodName) ?? canonicalId;
}

/** Test-only: clear the cache so unit tests can re-parse env on each call. */
export function _resetOverridesCacheForTests(): void {
  parseCache.clear();
  loggedOverrideHashes.clear();
}

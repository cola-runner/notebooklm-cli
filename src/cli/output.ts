/**
 * Machine- and human-friendly CLI output, plus a stable error taxonomy.
 *
 * Every data command accepts `--json` so an LLM/agent consumer parses results
 * reliably instead of scraping human text. Failures print a structured
 * `{ error: { code, message, … } }` under `--json` and always exit with a
 * class-specific code, so a caller can branch on WHAT failed without
 * string-matching the message.
 */

import {
  ArtifactDownloadError,
  ArtifactNotFoundError,
  ArtifactNotReadyError,
  ArtifactParseError,
  AuthError,
  NetworkError,
  RPCError,
  RateLimitError,
} from '../rpc/errors.js';

/** Exit codes by error class — a stable contract for scripted/agent callers. */
export const EXIT = {
  OK: 0,
  ERROR: 1, // generic / unexpected
  USAGE: 2, // bad CLI input
  AUTH: 3, // not signed in / session rejected
  NOT_FOUND: 4, // resource missing
  NOT_READY: 5, // artifact still generating
  RATE_LIMIT: 6, // throttled by the backend
  RPC: 7, // RPC / protocol failure
  NETWORK: 8, // transport / timeout
} as const;

export interface JsonFlag {
  json?: boolean;
}

export interface CliErrorInfo {
  code: string;
  exitCode: number;
  message: string;
  details?: Record<string, unknown>;
}

/** Map any thrown value to a stable {code, exitCode, message, details}. */
export function classifyError(err: unknown): CliErrorInfo {
  if (err instanceof AuthError) {
    return { code: 'AUTH', exitCode: EXIT.AUTH, message: err.message };
  }
  if (err instanceof ArtifactNotFoundError) {
    return { code: 'NOT_FOUND', exitCode: EXIT.NOT_FOUND, message: err.message };
  }
  if (err instanceof ArtifactNotReadyError) {
    return { code: 'NOT_READY', exitCode: EXIT.NOT_READY, message: err.message };
  }
  if (err instanceof RateLimitError) {
    return { code: 'RATE_LIMIT', exitCode: EXIT.RATE_LIMIT, message: err.message };
  }
  if (err instanceof NetworkError) {
    // Also covers RPCTimeoutError (subclass of NetworkError).
    return { code: 'NETWORK', exitCode: EXIT.NETWORK, message: err.message };
  }
  if (err instanceof ArtifactParseError || err instanceof ArtifactDownloadError) {
    return { code: 'ARTIFACT', exitCode: EXIT.RPC, message: err.message };
  }
  if (err instanceof RPCError) {
    const details: Record<string, unknown> = {};
    if (err.methodId) details['method'] = err.methodId;
    if (err.foundIds.length > 0) details['foundIds'] = err.foundIds;
    const info: CliErrorInfo = { code: 'RPC', exitCode: EXIT.RPC, message: err.message };
    if (Object.keys(details).length > 0) info.details = details;
    return info;
  }
  if (err instanceof Error) {
    return { code: 'ERROR', exitCode: EXIT.ERROR, message: err.message };
  }
  return { code: 'ERROR', exitCode: EXIT.ERROR, message: String(err) };
}

/** Emit a successful result: pretty JSON when `--json`, else the human render. */
export function emit<T>(opts: JsonFlag, data: T, human: (data: T) => void): void {
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  } else {
    human(data);
  }
}

/** Print a structured error and exit with its class-specific code. */
export function fail(opts: JsonFlag, err: unknown): never {
  const info = classifyError(err);
  if (opts.json) {
    // Write the error envelope to stdout (not stderr) so an agent capturing a
    // single `out=$(cmd --json)` stream always gets parseable JSON — either the
    // result or `{ error }` — disambiguated by the exit code.
    const payload = {
      error: { code: info.code, message: info.message, ...(info.details ?? {}) },
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (info.code === 'AUTH') {
    process.stderr.write(`\n${info.message}\n`);
    process.stderr.write("Hint: run 'notebooklm login' to refresh your session.\n");
  } else if (info.code === 'RPC') {
    process.stderr.write(`\nRPC error: ${info.message}\n`);
    const d = info.details ?? {};
    if (d['method']) process.stderr.write(`  method: ${String(d['method'])}\n`);
    if (Array.isArray(d['foundIds'])) {
      process.stderr.write(`  foundIds: ${d['foundIds'].join(', ')}\n`);
    }
  } else {
    process.stderr.write(`\n${info.message}\n`);
  }
  process.exit(info.exitCode);
}

/**
 * RPC and transport error hierarchy.
 *
 * Ported from `notebooklm-py/src/notebooklm/exceptions.py`. Kept structurally
 * compatible so callers can `instanceof`-check on specific subclasses.
 */

const MAX_RESPONSE_PREVIEW = 4096;

export function truncateResponsePreview(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  if (process.env['NOTEBOOKLM_DEBUG'] === '1') return raw;
  if (raw.length <= MAX_RESPONSE_PREVIEW) return raw;
  return `${raw.slice(0, MAX_RESPONSE_PREVIEW)}… [truncated; set NOTEBOOKLM_DEBUG=1 for full]`;
}

export interface RPCErrorOptions {
  methodId?: string;
  rpcCode?: number | string;
  foundIds?: string[];
  rawResponse?: string;
  cause?: unknown;
}

export class RPCError extends Error {
  readonly methodId: string | undefined;
  readonly rpcCode: number | string | undefined;
  foundIds: string[];
  rawResponse: string | undefined;

  constructor(message: string, opts: RPCErrorOptions = {}) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = 'RPCError';
    this.methodId = opts.methodId;
    this.rpcCode = opts.rpcCode;
    this.foundIds = opts.foundIds ?? [];
    this.rawResponse = truncateResponsePreview(opts.rawResponse);
  }
}

export class AuthError extends RPCError {
  constructor(message: string, opts: RPCErrorOptions = {}) {
    super(message, opts);
    this.name = 'AuthError';
  }
}

export class NetworkError extends RPCError {
  constructor(message: string, opts: RPCErrorOptions = {}) {
    super(message, opts);
    this.name = 'NetworkError';
  }
}

export class RPCTimeoutError extends NetworkError {
  constructor(message: string, opts: RPCErrorOptions = {}) {
    super(message, opts);
    this.name = 'RPCTimeoutError';
  }
}

export class RateLimitError extends RPCError {
  constructor(message: string, opts: RPCErrorOptions = {}) {
    super(message, opts);
    this.name = 'RateLimitError';
  }
}

export class ServerError extends RPCError {
  constructor(message: string, opts: RPCErrorOptions = {}) {
    super(message, opts);
    this.name = 'ServerError';
  }
}

export class ClientError extends RPCError {
  constructor(message: string, opts: RPCErrorOptions = {}) {
    super(message, opts);
    this.name = 'ClientError';
  }
}

export class UnknownRPCMethodError extends RPCError {
  constructor(message: string, opts: RPCErrorOptions = {}) {
    super(message, opts);
    this.name = 'UnknownRPCMethodError';
  }
}

export class ChatError extends RPCError {
  constructor(message: string, opts: RPCErrorOptions = {}) {
    super(message, opts);
    this.name = 'ChatError';
  }
}

/** Base class for artifact-domain failures (generation, parsing, download). */
export class ArtifactError extends RPCError {
  constructor(message: string, opts: RPCErrorOptions = {}) {
    super(message, opts);
    this.name = 'ArtifactError';
  }
}

/** An artifact exists but isn't COMPLETED yet (or none of its type exist). */
export class ArtifactNotReadyError extends ArtifactError {
  constructor(message: string, opts: RPCErrorOptions = {}) {
    super(message, opts);
    this.name = 'ArtifactNotReadyError';
  }
}

/** A requested artifact id could not be found. */
export class ArtifactNotFoundError extends ArtifactError {
  constructor(message: string, opts: RPCErrorOptions = {}) {
    super(message, opts);
    this.name = 'ArtifactNotFoundError';
  }
}

/** The artifact's response shape could not be parsed (URL/content extraction). */
export class ArtifactParseError extends ArtifactError {
  constructor(message: string, opts: RPCErrorOptions = {}) {
    super(message, opts);
    this.name = 'ArtifactParseError';
  }
}

/** A download failed (HTTP error, untrusted host, HTML body, missing URL). */
export class ArtifactDownloadError extends ArtifactError {
  constructor(message: string, opts: RPCErrorOptions = {}) {
    super(message, opts);
    this.name = 'ArtifactDownloadError';
  }
}

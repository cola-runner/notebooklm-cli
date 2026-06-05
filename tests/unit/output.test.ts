import { describe, expect, it } from 'vitest';
import { EXIT, classifyError } from '../../src/cli/output.js';
import {
  ArtifactDownloadError,
  ArtifactNotFoundError,
  ArtifactNotReadyError,
  AuthError,
  NetworkError,
  RPCError,
  RPCTimeoutError,
  RateLimitError,
} from '../../src/rpc/errors.js';

describe('classifyError — stable code + exit-code contract', () => {
  it('maps AuthError → AUTH / 3', () => {
    const info = classifyError(new AuthError('nope'));
    expect(info.code).toBe('AUTH');
    expect(info.exitCode).toBe(EXIT.AUTH);
  });

  it('maps ArtifactNotFoundError → NOT_FOUND / 4', () => {
    const info = classifyError(new ArtifactNotFoundError('gone'));
    expect(info).toMatchObject({ code: 'NOT_FOUND', exitCode: EXIT.NOT_FOUND });
  });

  it('maps ArtifactNotReadyError → NOT_READY / 5', () => {
    const info = classifyError(new ArtifactNotReadyError('wait'));
    expect(info).toMatchObject({ code: 'NOT_READY', exitCode: EXIT.NOT_READY });
  });

  it('maps RateLimitError → RATE_LIMIT / 6', () => {
    const info = classifyError(new RateLimitError('slow down'));
    expect(info).toMatchObject({ code: 'RATE_LIMIT', exitCode: EXIT.RATE_LIMIT });
  });

  it('maps NetworkError and RPCTimeoutError → NETWORK / 8', () => {
    expect(classifyError(new NetworkError('down')).exitCode).toBe(EXIT.NETWORK);
    expect(classifyError(new RPCTimeoutError('slow')).code).toBe('NETWORK');
  });

  it('maps ArtifactDownloadError → ARTIFACT / RPC exit', () => {
    const info = classifyError(new ArtifactDownloadError('bad host'));
    expect(info).toMatchObject({ code: 'ARTIFACT', exitCode: EXIT.RPC });
  });

  it('maps RPCError → RPC / 7 and surfaces method + foundIds details', () => {
    const info = classifyError(
      new RPCError('boom', { methodId: 'abc123', foundIds: ['xyz', 'qrs'] }),
    );
    expect(info).toMatchObject({ code: 'RPC', exitCode: EXIT.RPC });
    expect(info.details).toEqual({ method: 'abc123', foundIds: ['xyz', 'qrs'] });
  });

  it('maps a plain Error → ERROR / 1', () => {
    const info = classifyError(new Error('oops'));
    expect(info).toMatchObject({ code: 'ERROR', exitCode: EXIT.ERROR, message: 'oops' });
  });

  it('maps a non-Error throw → ERROR / 1 with stringified message', () => {
    const info = classifyError('weird');
    expect(info).toMatchObject({ code: 'ERROR', exitCode: EXIT.ERROR, message: 'weird' });
  });

  it('orders subclass checks so AuthError does not fall through to RPC', () => {
    // AuthError extends RPCError; the specific branch must win.
    expect(classifyError(new AuthError('x')).code).toBe('AUTH');
  });
});

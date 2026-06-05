import { describe, expect, it } from 'vitest';
import { buildRequestBody, encodeRpcRequest, nestSourceIds } from '../../src/rpc/encoder.js';
import { RPCMethod } from '../../src/rpc/types.js';

describe('encodeRpcRequest', () => {
  it('produces triple-nested array with compact JSON params', () => {
    const encoded = encodeRpcRequest(RPCMethod.LIST_NOTEBOOKS, [null, 0, null, [2]]);
    expect(encoded).toEqual([[['wXbhsf', '[null,0,null,[2]]', null, 'generic']]]);
  });

  it('uses rpcIdOverride when provided', () => {
    const encoded = encodeRpcRequest(RPCMethod.LIST_NOTEBOOKS, [], 'override123');
    expect(encoded[0][0][0]).toBe('override123');
  });

  it('compact-serializes nested params (no spaces)', () => {
    const encoded = encodeRpcRequest(RPCMethod.CREATE_NOTEBOOK, [{ a: 1, b: [2, 3] }]);
    expect(encoded[0][0][1]).toBe('[{"a":1,"b":[2,3]}]');
  });
});

describe('buildRequestBody', () => {
  it('URL-encodes f.req and appends trailing &', () => {
    const encoded = encodeRpcRequest(RPCMethod.LIST_NOTEBOOKS, [null]);
    const body = buildRequestBody(encoded);
    expect(body).toMatch(/^f\.req=/);
    expect(body.endsWith('&')).toBe(true);
    expect(body).toContain('wXbhsf');
  });

  it('includes CSRF token as at= when provided', () => {
    const encoded = encodeRpcRequest(RPCMethod.LIST_NOTEBOOKS, []);
    const body = buildRequestBody(encoded, 'TOKEN/withspecial=chars');
    expect(body).toContain('at=TOKEN%2Fwithspecial%3Dchars');
  });

  it('special chars in payload are URL-encoded inside f.req', () => {
    const encoded = encodeRpcRequest(RPCMethod.LIST_NOTEBOOKS, ['hello world & friends']);
    const body = buildRequestBody(encoded);
    // The literal space and & must be encoded inside the URL-encoded f.req
    expect(body).not.toContain('hello world');
    expect(body).toContain('hello%20world');
  });
});

describe('nestSourceIds', () => {
  it('depth=1 wraps each id once', () => {
    expect(nestSourceIds(['a', 'b'], 1)).toEqual([['a'], ['b']]);
  });

  it('depth=2 wraps each id twice', () => {
    expect(nestSourceIds(['a', 'b'], 2)).toEqual([[['a']], [['b']]]);
  });

  it('depth=3 wraps each id three times', () => {
    expect(nestSourceIds(['a'], 3)).toEqual([[[['a']]]]);
  });

  it('returns empty array for null/empty input', () => {
    expect(nestSourceIds(null, 1)).toEqual([]);
    expect(nestSourceIds([], 2)).toEqual([]);
  });

  it('throws for depth < 1', () => {
    expect(() => nestSourceIds(['a'], 0)).toThrow(RangeError);
  });
});

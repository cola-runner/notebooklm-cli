import { describe, expect, it } from 'vitest';
import {
  collectRpcIds,
  decodeResponse,
  parseChunkedResponse,
  stripAntiXssi,
} from '../../src/rpc/decoder.js';
import { RPCError, RateLimitError, UnknownRPCMethodError } from '../../src/rpc/errors.js';

describe('stripAntiXssi', () => {
  it("strips )]}'\\n prefix", () => {
    expect(stripAntiXssi(")]}'\n[1,2,3]")).toBe('[1,2,3]');
  });

  it("strips )]}'\\r\\n prefix (Windows line endings)", () => {
    expect(stripAntiXssi(")]}'\r\n[1,2,3]")).toBe('[1,2,3]');
  });

  it('returns response unchanged when no prefix present', () => {
    expect(stripAntiXssi('[1,2,3]')).toBe('[1,2,3]');
  });
});

describe('parseChunkedResponse', () => {
  it('parses byte-count + payload pairs', () => {
    const input = '5\n[1,2]\n3\n[3]';
    expect(parseChunkedResponse(input)).toEqual([[1, 2], [3]]);
  });

  it('tolerates byte-count mismatch when JSON is valid', () => {
    // Declared count is wrong but JSON parses fine — should not throw
    expect(parseChunkedResponse('999\n[1,2]')).toEqual([[1, 2]]);
  });

  it('returns empty array for empty input', () => {
    expect(parseChunkedResponse('')).toEqual([]);
    expect(parseChunkedResponse('   ')).toEqual([]);
  });

  it('throws when malformed ratio > 10%', () => {
    // 5 records, 4 malformed = 80% bad
    const input = '5\nNOT_JSON\n5\nNOT_JSON\n5\nNOT_JSON\n5\nNOT_JSON\n5\n[1]';
    expect(() => parseChunkedResponse(input)).toThrow(RPCError);
  });
});

describe('collectRpcIds', () => {
  it("finds 'wrb.fr' and 'er' tagged entries", () => {
    const chunks = [
      [['wrb.fr', 'abc123', '[]', null, null, null, 'generic']],
      [['er', 'xyz789', 401]],
    ];
    expect(collectRpcIds(chunks)).toEqual(['abc123', 'xyz789']);
  });
});

describe('decodeResponse', () => {
  it('extracts wrb.fr result for matching RPC id', () => {
    const payload = JSON.stringify([['wrb.fr', 'wXbhsf', '[1,[],{}]', null, null, 0, 'generic']]);
    const raw = `)]}'\n${payload.length}\n${payload}`;
    const result = decodeResponse(raw, 'wXbhsf');
    expect(result).toEqual([1, [], {}]);
  });

  it('throws UnknownRPCMethodError when expected id is missing', () => {
    const payload = JSON.stringify([['wrb.fr', 'other', '[]', null, null, 0, 'generic']]);
    const raw = `)]}'\n${payload.length}\n${payload}`;
    expect(() => decodeResponse(raw, 'wXbhsf')).toThrow(UnknownRPCMethodError);
  });

  it('raises RPCError on er tag for matching id', () => {
    const payload = JSON.stringify([['er', 'wXbhsf', 401]]);
    const raw = `)]}'\n${payload.length}\n${payload}`;
    expect(() => decodeResponse(raw, 'wXbhsf')).toThrow(RPCError);
  });

  it('raises RateLimitError when wrb.fr has UserDisplayableError at index 5', () => {
    const errBlock = ['UserDisplayableError', 'quota exceeded'];
    const payload = JSON.stringify([['wrb.fr', 'wXbhsf', null, null, null, errBlock, 'generic']]);
    const raw = `)]}'\n${payload.length}\n${payload}`;
    expect(() => decodeResponse(raw, 'wXbhsf')).toThrow(RateLimitError);
  });

  it('returns null for null result when allowNull is true', () => {
    const payload = JSON.stringify([['wrb.fr', 'wXbhsf', null, null, null, 0, 'generic']]);
    const raw = `)]}'\n${payload.length}\n${payload}`;
    expect(decodeResponse(raw, 'wXbhsf', { allowNull: true })).toBe(null);
  });
});

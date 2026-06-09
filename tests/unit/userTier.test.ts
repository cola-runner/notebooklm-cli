import { describe, expect, it } from 'vitest';
import { parseUserSettings, parseUserTier, tierLabelFor } from '../../src/api/user.js';

describe('tierLabelFor', () => {
  it('maps known tier constants to friendly labels', () => {
    expect(tierLabelFor('NOTEBOOKLM_TIER_STANDARD')).toBe('Free');
    expect(tierLabelFor('NOTEBOOKLM_TIER_PLUS')).toBe('AI Plus');
    expect(tierLabelFor('NOTEBOOKLM_TIER_PRO')).toBe('AI Pro');
    expect(tierLabelFor('NOTEBOOKLM_TIER_ULTRA')).toBe('AI Ultra');
  });

  it('falls back to the raw value for unknown tiers and "Unknown" for none', () => {
    expect(tierLabelFor('NOTEBOOKLM_TIER_FUTURE')).toBe('NOTEBOOKLM_TIER_FUTURE');
    expect(tierLabelFor(undefined)).toBe('Unknown');
  });
});

describe('parseUserTier', () => {
  it('finds the tier constant regardless of nesting depth', () => {
    const fixture = [[[['NOTEBOOKLM_TIER_ULTRA', 1, [2]]]]];
    expect(parseUserTier(fixture)).toEqual({
      tier: 'NOTEBOOKLM_TIER_ULTRA',
      tierLabel: 'AI Ultra',
    });
  });

  it('finds the tier when wrapped beside unrelated strings', () => {
    const fixture = [['some-id', ['NOTEBOOKLM_TIER_STANDARD']], 'NOT_A_TIER'];
    expect(parseUserTier(fixture)).toEqual({
      tier: 'NOTEBOOKLM_TIER_STANDARD',
      tierLabel: 'Free',
    });
  });

  it('returns Unknown when no tier string is present', () => {
    expect(parseUserTier([[[]]])).toEqual({ tierLabel: 'Unknown' });
    expect(parseUserTier(null)).toEqual({ tierLabel: 'Unknown' });
  });
});

describe('parseUserSettings', () => {
  it('extracts notebook/source limits and language from the documented shape', () => {
    // result[0][1] = limits, result[0][2][4][0] = language (per rpc-reference)
    const fixture = [
      [null, [6, 500, 300, 500000], [true, null, null, true, ['ja']], [[1]], [true, 1, 3, 2]],
    ];
    expect(parseUserSettings(fixture)).toEqual({
      notebookLimit: 500,
      sourceLimit: 300,
      language: 'ja',
    });
  });

  it('returns an empty object for malformed/empty responses', () => {
    expect(parseUserSettings(null)).toEqual({});
    expect(parseUserSettings([])).toEqual({});
    expect(parseUserSettings([[null, 'not-an-array']])).toEqual({});
  });
});

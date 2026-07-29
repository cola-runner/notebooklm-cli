import { describe, expect, it } from 'vitest';
import {
  UserAPI,
  parseUserSettings,
  tierConstantForCode,
  tierLabelForCode,
} from '../../src/api/user.js';
import type { Session } from '../../src/session/session.js';

describe('tierLabelForCode', () => {
  it.each([
    [1, 'Free'],
    [2, 'Pro'],
    [4, 'Plus'],
    [3, 'Ultra'],
    [6, 'Ultra'],
    [5, 'Expanded'],
  ])('maps tier code %s to %s', (code, label) => {
    expect(tierLabelForCode(code)).toBe(label);
  });

  it('does not invent a label for unknown or absent codes', () => {
    expect(tierLabelForCode(99)).toBe('Unknown (99)');
    expect(tierLabelForCode(undefined)).toBe('Unknown');
  });
});

describe('tierConstantForCode', () => {
  it('maps authoritative codes to Gemini Notebook tier constants', () => {
    expect(tierConstantForCode(1)).toBe('GEMINI_NOTEBOOK_TIER_STANDARD');
    expect(tierConstantForCode(2)).toBe('GEMINI_NOTEBOOK_TIER_PRO');
    expect(tierConstantForCode(4)).toBe('GEMINI_NOTEBOOK_TIER_PLUS');
    expect(tierConstantForCode(3)).toBe('GEMINI_NOTEBOOK_TIER_ULTRA');
    expect(tierConstantForCode(6)).toBe('GEMINI_NOTEBOOK_TIER_ULTRA');
    expect(tierConstantForCode(5)).toBe('GEMINI_NOTEBOOK_TIER_EXPANDED');
    expect(tierConstantForCode(99)).toBeUndefined();
  });
});

describe('parseUserSettings', () => {
  it('extracts notebook/source limits, authoritative tier, and language', () => {
    const fixture = [
      [null, [6, 500, 300, 500000, 2], [true, null, null, true, ['ja']], [[1]], [true, 1, 3, 2]],
    ];
    expect(parseUserSettings(fixture)).toEqual({
      notebookLimit: 500,
      sourceLimit: 300,
      tierCode: 2,
      language: 'ja',
    });
  });

  it('ignores absent, non-positive, boolean, and non-integer tier values', () => {
    expect(parseUserSettings([[null, [6, 500, 300, 500000]]])).toEqual({
      notebookLimit: 500,
      sourceLimit: 300,
    });
    expect(parseUserSettings([[null, [6, 500, 300, 500000, 0]]]).tierCode).toBeUndefined();
    expect(parseUserSettings([[null, [6, 500, 300, 500000, true]]]).tierCode).toBeUndefined();
    expect(parseUserSettings([[null, [6, 500, 300, 500000, 2.5]]]).tierCode).toBeUndefined();
  });

  it('returns an empty object for malformed/empty responses', () => {
    expect(parseUserSettings(null)).toEqual({});
    expect(parseUserSettings([])).toEqual({});
    expect(parseUserSettings([[null, 'not-an-array']])).toEqual({});
  });
});

describe('UserAPI.whoami', () => {
  it('fetches settings once and derives the compatibility tier', async () => {
    const calls: string[] = [];
    const session = {
      call: async (method: string) => {
        calls.push(method);
        return [[null, [6, 500, 300, 500000, 2], [true, null, null, true, ['en']]]];
      },
    } as unknown as Session;

    const account = await new UserAPI(session).whoami();

    expect(calls).toEqual(['GET_USER_SETTINGS']);
    expect(account).toEqual({
      tier: 'GEMINI_NOTEBOOK_TIER_PRO',
      tierCode: 2,
      tierLabel: 'Pro',
      notebookLimit: 500,
      sourceLimit: 300,
      language: 'en',
    });
  });
});

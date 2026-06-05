import { describe, expect, it } from 'vitest';
import { SourceStatus } from '../../src/rpc/types.js';
import { parseSource } from '../../src/types.js';
import { isGoogleAuthRedirect, isYoutubeUrl } from '../../src/urlUtils.js';

describe('isYoutubeUrl', () => {
  it('matches youtube.com and youtu.be', () => {
    expect(isYoutubeUrl('https://www.youtube.com/watch?v=abc')).toBe(true);
    expect(isYoutubeUrl('https://youtube.com/watch?v=abc')).toBe(true);
    expect(isYoutubeUrl('https://youtu.be/abc')).toBe(true);
    expect(isYoutubeUrl('https://m.youtube.com/watch?v=abc')).toBe(true);
  });

  it('rejects URLs that only contain youtube as a path', () => {
    expect(isYoutubeUrl('https://evil.com/youtube.com')).toBe(false);
    expect(isYoutubeUrl('https://example.com')).toBe(false);
  });

  it('returns false for malformed URLs', () => {
    expect(isYoutubeUrl('not a url')).toBe(false);
    expect(isYoutubeUrl('')).toBe(false);
  });
});

describe('isGoogleAuthRedirect', () => {
  it('detects accounts.google.com', () => {
    expect(isGoogleAuthRedirect('https://accounts.google.com/ServiceLogin')).toBe(true);
    expect(isGoogleAuthRedirect('https://x.accounts.google.com/foo')).toBe(true);
    expect(isGoogleAuthRedirect('https://google.com/')).toBe(false);
  });
});

describe('parseSource', () => {
  it('parses a minimal source row with bare string id', () => {
    const raw = ['src-abc-123', 'Hello PDF', null, [null, SourceStatus.READY]];
    const src = parseSource(raw);
    expect(src).not.toBeNull();
    expect(src?.id).toBe('src-abc-123');
    expect(src?.title).toBe('Hello PDF');
    expect(src?.status).toBe(SourceStatus.READY);
  });

  it('parses an id wrapped in a single-element array', () => {
    const raw = [['src-xyz'], 'wrapped', null];
    const src = parseSource(raw);
    expect(src?.id).toBe('src-xyz');
  });

  it('extracts URL from metadata[3][2]', () => {
    const raw = [
      'src-1',
      'A URL source',
      [null, null, null, [null, null, 'https://example.com', 2]],
      [null, SourceStatus.READY],
    ];
    const src = parseSource(raw);
    expect(src?.url).toBe('https://example.com');
    expect(src?.typeCode).toBe(2);
  });

  it('returns null for malformed input', () => {
    expect(parseSource(null)).toBeNull();
    expect(parseSource([])).toBeNull();
    expect(parseSource('not an array')).toBeNull();
    expect(parseSource([{ unexpected: true }])).toBeNull();
  });
});

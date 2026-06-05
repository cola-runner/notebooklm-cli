import { describe, expect, it } from 'vitest';
import {
  cookiesToStorageState,
  extractCookieString,
  parseCookiePairs,
  parseCurlCookies,
} from '../../src/auth/curlCookies.js';

describe('extractCookieString', () => {
  it('extracts from Chrome/Linux bash single-quote form', () => {
    const curl = [
      "curl 'https://notebooklm.google.com/' \\",
      "  -H 'accept: text/html' \\",
      "  -H 'cookie: SID=aaa; __Secure-1PSID=bbb; NID=511=ccc' \\",
      '  --compressed',
    ].join('\n');
    expect(extractCookieString(curl)).toBe('SID=aaa; __Secure-1PSID=bbb; NID=511=ccc');
  });

  it('extracts from bash ANSI-C dollar-quote form', () => {
    const curl = "curl 'https://x' -H $'cookie: SID=aaa; __Secure-1PSID=bbb'";
    expect(extractCookieString(curl)).toBe('SID=aaa; __Secure-1PSID=bbb');
  });

  it('extracts from double-quoted form', () => {
    const curl = 'curl "https://x" -H "cookie: SID=aaa; __Secure-1PSID=bbb"';
    expect(extractCookieString(curl)).toBe('SID=aaa; __Secure-1PSID=bbb');
  });

  it('extracts from Windows cmd.exe caret-escaped form', () => {
    const curl = 'curl ^"https://x^" ^\n  -H ^"cookie: SID=aaa; __Secure-1PSID=bbb^"';
    expect(extractCookieString(curl)).toBe('SID=aaa; __Secure-1PSID=bbb');
  });

  it('is case-insensitive on the header name (Firefox uses Cookie:)', () => {
    const curl = "curl 'https://x' -X GET -H 'Cookie: SID=aaa'";
    expect(extractCookieString(curl)).toBe('SID=aaa');
  });

  it('extracts from -b / --cookie jar flags', () => {
    expect(extractCookieString("curl 'https://x' -b 'SID=aaa; X=1'")).toBe('SID=aaa; X=1');
    expect(extractCookieString("curl 'https://x' --cookie 'SID=aaa'")).toBe('SID=aaa');
  });

  it('accepts a bare Cookie: header', () => {
    expect(extractCookieString('Cookie: SID=aaa; __Secure-1PSID=bbb')).toBe(
      'SID=aaa; __Secure-1PSID=bbb',
    );
  });

  it('accepts a bare name=value string', () => {
    expect(extractCookieString('SID=aaa; __Secure-1PSID=bbb')).toBe('SID=aaa; __Secure-1PSID=bbb');
  });
});

describe('parseCookiePairs', () => {
  it('splits on the first = so base64/padded values survive', () => {
    const pairs = parseCookiePairs('SID=aaa; __Secure-1PSIDTS=sidts-CjEB==; NID=511=zzz');
    expect(pairs).toEqual([
      { name: 'SID', value: 'aaa' },
      { name: '__Secure-1PSIDTS', value: 'sidts-CjEB==' },
      { name: 'NID', value: '511=zzz' },
    ]);
  });

  it('skips empty and malformed segments', () => {
    expect(parseCookiePairs('; SID=aaa; ; =orphan; bad')).toEqual([{ name: 'SID', value: 'aaa' }]);
  });
});

describe('parseCurlCookies + cookiesToStorageState', () => {
  it('produces a .google.com-scoped storage state from a full curl', () => {
    const curl = "curl 'https://notebooklm.google.com/' -H 'cookie: SID=aaa; __Secure-1PSID=bbb'";
    const state = cookiesToStorageState(parseCurlCookies(curl));
    expect(state.origins).toEqual([]);
    expect(state.cookies).toHaveLength(2);
    expect(state.cookies[0]).toMatchObject({
      name: 'SID',
      value: 'aaa',
      domain: '.google.com',
      path: '/',
      secure: true,
    });
  });

  it('returns no pairs for input without cookies', () => {
    expect(parseCurlCookies("curl 'https://x' -H 'accept: text/html'")).toEqual([]);
  });
});

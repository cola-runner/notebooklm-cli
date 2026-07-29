import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageState } from '../../src/auth/types.js';

const requestMock = vi.hoisted(() => vi.fn());

vi.mock('undici', () => ({
  request: requestMock,
}));

import { Transport } from '../../src/session/transport.js';

const state: StorageState = {
  cookies: [
    {
      name: 'SID',
      value: 'test-session',
      domain: '.google.com',
      path: '/',
      secure: true,
      httpOnly: true,
    },
  ],
  origins: [],
};

describe('Transport homepage redirects', () => {
  beforeEach(() => {
    process.env['GEMINI_NOTEBOOK_BASE_URL'] = 'https://notebooklm.google.com';
    requestMock.mockReset();
  });

  afterEach(() => {
    process.env['GEMINI_NOTEBOOK_BASE_URL'] = undefined;
  });

  it('re-scopes origin and referer headers when the app moves to a new origin', async () => {
    requestMock
      .mockResolvedValueOnce({
        statusCode: 302,
        headers: { location: 'https://notebook.google.com/' },
        body: { text: async () => '' },
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: { text: async () => '<html>ok</html>' },
      });

    const transport = new Transport({
      storagePath: '/tmp/gemini-notebook-test-storage.json',
      state,
      disableKeepalive: true,
    });

    await transport.getHomepage();

    const redirectedInit = requestMock.mock.calls[1]?.[1] as
      | { headers?: Record<string, string> }
      | undefined;
    expect(redirectedInit?.headers?.['Origin']).toBe('https://notebook.google.com');
    expect(redirectedInit?.headers?.['Referer']).toBe('https://notebook.google.com/');
  });

  it('does not claim an accounts redirect originated from the accounts site', async () => {
    requestMock
      .mockResolvedValueOnce({
        statusCode: 302,
        headers: { location: 'https://accounts.google.com/ServiceLogin' },
        body: { text: async () => '' },
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: { text: async () => '<html>sign in</html>' },
      });

    const transport = new Transport({
      storagePath: '/tmp/gemini-notebook-test-storage.json',
      state,
      disableKeepalive: true,
    });

    await transport.getHomepage();

    const accountsInit = requestMock.mock.calls[1]?.[1] as
      | { headers?: Record<string, string> }
      | undefined;
    expect(accountsInit?.headers?.['Origin']).toBe('https://notebooklm.google.com');
    expect(accountsInit?.headers?.['Referer']).toBe('https://notebooklm.google.com/');
  });
});

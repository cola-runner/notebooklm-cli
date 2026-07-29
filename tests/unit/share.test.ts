/**
 * Regression guards for share-status parsing + RPC params.
 *
 * Verified live (status → public → private). The GET_SHARE_STATUS response is
 * `[[[user_entries]], [is_public], 1000]`; SHARE_NOTEBOOK toggles visibility.
 */

import { describe, expect, it } from 'vitest';
import { ShareAPI } from '../../src/api/share.js';
import type { Session } from '../../src/session/session.js';

function makeShare(responses: Record<string, unknown>): {
  share: ShareAPI;
  calls: Array<{ method: string; params: unknown[] }>;
} {
  const calls: Array<{ method: string; params: unknown[] }> = [];
  const session = {
    call: async (method: string, params: unknown[]) => {
      calls.push({ method, params });
      return responses[method] ?? null;
    },
  } as unknown as Session;
  return { share: new ShareAPI(session), calls };
}

describe('ShareAPI.getStatus', () => {
  it('parses a public notebook with a collaborator and builds the share url', async () => {
    const resp = [[['a@b.com', 1, [], ['Alice', 'http://avatar']]], [1], 1000];
    const { share, calls } = makeShare({ GET_SHARE_STATUS: resp });
    const status = await share.getStatus('nb-1');
    expect(calls[0]).toEqual({ method: 'GET_SHARE_STATUS', params: ['nb-1', [2]] });
    expect(status.isPublic).toBe(true);
    expect(status.access).toBe(1);
    expect(status.shareUrl).toBe('https://notebook.google.com/notebook/nb-1');
    expect(status.sharedUsers).toEqual([
      { email: 'a@b.com', permission: 1, displayName: 'Alice', avatarUrl: 'http://avatar' },
    ]);
  });

  it('reports a private notebook with no share url', async () => {
    const { share } = makeShare({ GET_SHARE_STATUS: [[], [0], 1000] });
    const status = await share.getStatus('nb-1');
    expect(status.isPublic).toBe(false);
    expect(status.shareUrl).toBeUndefined();
    expect(status.sharedUsers).toEqual([]);
  });
});

describe('ShareAPI.setPublic', () => {
  it('sends SHARE_NOTEBOOK with the anyone-with-link access params', async () => {
    const { share, calls } = makeShare({ GET_SHARE_STATUS: [[], [1], 1000] });
    await share.setPublic('nb-1', true);
    expect(calls[0]).toEqual({
      method: 'SHARE_NOTEBOOK',
      params: [[['nb-1', null, [1], [1, '']]], 1, null, [2]],
    });
    // followed by a status refresh
    expect(calls[1]?.method).toBe('GET_SHARE_STATUS');
  });
});

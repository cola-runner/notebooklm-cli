/**
 * Regression guards for conversation-id resolution (multi-turn chat).
 *
 * The hPTbtc RPC must be called with params `[[], null, notebookId, 1]` and its
 * `[[[conv_id]]]` response walked to the leaf string. An earlier cut passed
 * `[notebookId]` and read the top-level element, so the id always came back
 * undefined and follow-ups could not continue a conversation.
 */

import { describe, expect, it } from 'vitest';
import { ChatAPI } from '../../src/api/chat.js';
import type { Session } from '../../src/session/session.js';

/** ChatAPI whose session.call records params and returns a canned response. */
function makeChat(response: unknown): {
  chat: ChatAPI;
  lastCall: () => { method: string; params: unknown[] };
} {
  let method = '';
  let params: unknown[] = [];
  const session = {
    call: async (m: string, p: unknown[]) => {
      method = m;
      params = p;
      return response;
    },
  } as unknown as Session;
  return { chat: new ChatAPI(session), lastCall: () => ({ method, params }) };
}

describe('ChatAPI.getConversationId', () => {
  it('sends the [[], null, notebookId, 1] params and parses the nested id', async () => {
    const { chat, lastCall } = makeChat([[['conv-abc-123']]]);
    const id = await chat.getConversationId('nb-1');
    expect(id).toBe('conv-abc-123');
    const { method, params } = lastCall();
    expect(method).toBe('GET_LAST_CONVERSATION_ID');
    expect(params).toEqual([[], null, 'nb-1', 1]);
  });

  it('returns undefined for a null response (no conversation yet)', async () => {
    const { chat } = makeChat(null);
    expect(await chat.getConversationId('nb-1')).toBeUndefined();
  });

  it('returns undefined for an unexpected shape', async () => {
    const { chat } = makeChat([['not-nested-deep-enough']]);
    expect(await chat.getConversationId('nb-1')).toBeUndefined();
  });
});

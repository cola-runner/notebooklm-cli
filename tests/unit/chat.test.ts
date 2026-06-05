import { describe, expect, it } from 'vitest';
import { parseStreamingChatResponse } from '../../src/api/chat.js';
import { ChatError } from '../../src/rpc/errors.js';

function makeChunk(answer: string, isMarked: boolean): string {
  // Inner JSON: [[answer, _, _, _, [..., is_marked ? 1 : 0]]]
  const inner = JSON.stringify([[answer, null, null, null, [null, isMarked ? 1 : 0]]]);
  const wrb = JSON.stringify([['wrb.fr', 'streamId', inner]]);
  return `${wrb.length}\n${wrb}`;
}

describe('parseStreamingChatResponse', () => {
  it('extracts marked answer over unmarked text', () => {
    const body = `)]}'\n${makeChunk('intermediate thinking', false)}\n${makeChunk('final answer here', true)}`;
    const result = parseStreamingChatResponse(body);
    expect(result.answer).toBe('final answer here');
  });

  it('picks the longest marked answer when several chunks are marked', () => {
    const body = `)]}'\n${makeChunk('short', true)}\n${makeChunk('this is a longer marked answer', true)}`;
    const result = parseStreamingChatResponse(body);
    expect(result.answer).toBe('this is a longer marked answer');
  });

  it('falls back to longest unmarked text when no marked answer exists', () => {
    const body = `)]}'\n${makeChunk('only unmarked text', false)}`;
    const result = parseStreamingChatResponse(body);
    expect(result.answer).toBe('only unmarked text');
  });

  it('throws ChatError when no wrb.fr envelopes are recognised', () => {
    const body = ")]}'\ngarbage that is not JSON";
    expect(() => parseStreamingChatResponse(body)).toThrow(ChatError);
  });

  it('handles empty answer with parseable wrb.fr (server returned blank)', () => {
    // wrb.fr with empty answer text is still parseable, returns ""
    const inner = JSON.stringify([['', null, null, null, [null, 1]]]);
    const wrb = JSON.stringify([['wrb.fr', 's1', inner]]);
    const body = `)]}'\n${wrb.length}\n${wrb}`;
    const result = parseStreamingChatResponse(body);
    expect(result.answer).toBe('');
  });
});

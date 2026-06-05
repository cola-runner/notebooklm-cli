/**
 * Regression guard for streamed-chat citation extraction.
 *
 * The wire shape below mirrors what the live API returns (verified against the
 * SpaceX notebook): an answer record `first` where `first[0]` is the text and
 * `first[4]` is type-info whose `[3]` slot holds the citation list and whose
 * last element (1) marks it as the final answer. Each citation carries a
 * nested source UUID, a relevance score, an answer-text range, source-side
 * char offsets, and cited passage text.
 */

import { describe, expect, it } from 'vitest';
import { parseStreamingChatResponse } from '../../src/api/chat.js';

const SRC = '5f6edf72-1a02-4ff8-82d9-028be3a9fca8';

/** Build one citation entry in the live wire layout. */
function citation(): unknown {
  const citeInner = [
    null,
    null,
    0.75, // [2] score
    [[null, 10, 25]], // [3] answer-text range → answerStart=10, answerEnd=25
    // [4] passages: wrapper → passage [startChar, endChar, nested-texts]
    [[[100, 130, [[[null, null, 'the cited passage']]]]]],
    [[SRC]], // [5] nested source id
  ];
  return [['chunk-1'], citeInner];
}

/** Wrap an answer record into a full streamed `wrb.fr` response body. */
function wireBody(text: string, isAnswer: boolean): string {
  const typeInfo = isAnswer
    ? [null, null, null, [citation()], 1]
    : [null, null, null, [citation()]];
  const first = [text, null, null, null, typeInfo];
  const innerData = [first];
  const chunk = [['wrb.fr', null, JSON.stringify(innerData)]];
  return `)]}'\n\n${JSON.stringify(chunk)}\n`;
}

describe('parseStreamingChatResponse — citations', () => {
  it('extracts a fully-populated citation from a marked answer', () => {
    const { answer, references } = parseStreamingChatResponse(
      wireBody('SpaceX was founded…', true),
    );
    expect(answer).toBe('SpaceX was founded…');
    expect(references).toHaveLength(1);
    const ref = references[0]!;
    expect(ref.sourceId).toBe(SRC);
    expect(ref.citationNumber).toBe(1);
    expect(ref.score).toBe(0.75);
    expect(ref.citedText).toBe('the cited passage');
    expect(ref.startChar).toBe(100);
    expect(ref.endChar).toBe(130);
    expect(ref.answerStartChar).toBe(10);
    expect(ref.answerEndChar).toBe(25);
    expect(ref.chunkId).toBe('chunk-1');
  });

  it('returns an empty reference list when the answer has no citations', () => {
    const chunk = [['wrb.fr', null, JSON.stringify([['plain answer', null, null, null, [1]]])]];
    const { answer, references } = parseStreamingChatResponse(`)]}'\n${JSON.stringify(chunk)}\n`);
    expect(answer).toBe('plain answer');
    expect(references).toEqual([]);
  });
});

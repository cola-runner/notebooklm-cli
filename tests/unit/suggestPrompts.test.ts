import { describe, expect, it } from 'vitest';
import { buildSuggestPromptsParams, parsePromptSuggestions } from '../../src/api/notebooks.js';

describe('buildSuggestPromptsParams', () => {
  it('matches the upstream SUGGEST_PROMPTS param shape', () => {
    // Golden shape from notebooklm-py build_prompt_suggestions_params:
    // [ctx, notebookId, [[sid], …], mode, null, query].
    expect(buildSuggestPromptsParams('NB_1', ['s1', 's2'], 4, 'focus on risks')).toEqual([
      [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]]],
      'NB_1',
      [['s1'], ['s2']],
      4,
      null,
      'focus on risks',
    ]);
  });

  it('nulls an empty/whitespace steer and an empty source list', () => {
    const params = buildSuggestPromptsParams('NB_1', [], 5, '   ');
    expect(params[2]).toEqual([]); // no sources
    expect(params[3]).toBe(5); // mode
    expect(params[5]).toBeNull(); // blank query → null
  });

  it('rejects an out-of-range or non-integer mode before any network call', () => {
    expect(() => buildSuggestPromptsParams('NB_1', [], 0)).toThrow(/mode must be/);
    expect(() => buildSuggestPromptsParams('NB_1', [], 10)).toThrow(/mode must be/);
    expect(() => buildSuggestPromptsParams('NB_1', [], 2.5)).toThrow(/mode must be/);
  });
});

describe('parsePromptSuggestions', () => {
  it('unwraps the [[ [title, prompt], … ]] envelope', () => {
    const reply = [
      [
        ['History Focus', 'What is the historical context of this material?'],
        ['For Students', 'Explain the key concepts as if teaching a class.'],
      ],
    ];
    expect(parsePromptSuggestions(reply)).toEqual([
      { title: 'History Focus', prompt: 'What is the historical context of this material?' },
      { title: 'For Students', prompt: 'Explain the key concepts as if teaching a class.' },
    ]);
  });

  it('degrades missing fields to empty strings and drops fully-empty rows', () => {
    const reply = [[['Title only'], [null, 'Prompt only'], [], 'not-a-row']];
    expect(parsePromptSuggestions(reply)).toEqual([
      { title: 'Title only', prompt: '' },
      { title: '', prompt: 'Prompt only' },
    ]);
  });

  it('returns [] for a degenerate payload', () => {
    expect(parsePromptSuggestions(null)).toEqual([]);
    expect(parsePromptSuggestions([])).toEqual([]);
    expect(parsePromptSuggestions(['not-a-list'])).toEqual([]);
  });
});

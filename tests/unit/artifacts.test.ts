import { describe, expect, it } from 'vitest';
import {
  extractAppData,
  extractCellText,
  formatQuizMarkdown,
  parseDataTable,
  toCsv,
} from '../../src/artifactFormatters.js';
import {
  ArtifactType,
  artifactMatchesType,
  extractArtifactUrl,
  mapArtifactKind,
  parseArtifact,
  parseMindMapArtifact,
} from '../../src/artifactParse.js';
import { ArtifactStatus, ArtifactTypeCode } from '../../src/rpc/types.js';

/** Build a sparse artifact row, assigning values at the given indices. */
function row(slots: Record<number, unknown>): unknown[] {
  const max = Math.max(...Object.keys(slots).map(Number));
  const arr: unknown[] = new Array(max + 1).fill(null);
  for (const [k, v] of Object.entries(slots)) arr[Number(k)] = v;
  return arr;
}

describe('mapArtifactKind', () => {
  it('maps known type codes to kinds', () => {
    expect(mapArtifactKind(ArtifactTypeCode.AUDIO, undefined)).toBe(ArtifactType.AUDIO);
    expect(mapArtifactKind(ArtifactTypeCode.VIDEO, undefined)).toBe(ArtifactType.VIDEO);
    expect(mapArtifactKind(ArtifactTypeCode.REPORT, undefined)).toBe(ArtifactType.REPORT);
    expect(mapArtifactKind(ArtifactTypeCode.SLIDE_DECK, undefined)).toBe(ArtifactType.SLIDE_DECK);
  });

  it('distinguishes quiz (variant 2) from flashcards (variant 1)', () => {
    expect(mapArtifactKind(ArtifactTypeCode.QUIZ, 2)).toBe(ArtifactType.QUIZ);
    expect(mapArtifactKind(ArtifactTypeCode.QUIZ, 1)).toBe(ArtifactType.FLASHCARDS);
    expect(mapArtifactKind(ArtifactTypeCode.QUIZ, 99)).toBe(ArtifactType.UNKNOWN);
  });

  it('returns UNKNOWN for unrecognized codes', () => {
    expect(mapArtifactKind(424242, undefined)).toBe(ArtifactType.UNKNOWN);
  });
});

describe('parseArtifact', () => {
  it('parses a completed audio artifact with url and timestamp', () => {
    const data = row({
      0: 'art-1',
      1: 'My Audio',
      2: ArtifactTypeCode.AUDIO,
      4: ArtifactStatus.COMPLETED,
      6: [
        null,
        null,
        null,
        null,
        null,
        [['https://lh3.googleusercontent.com/a.mp4', 0, 'audio/mp4']],
      ],
      15: [1_700_000_000],
    });
    const art = parseArtifact(data);
    expect(art).not.toBeNull();
    expect(art?.id).toBe('art-1');
    expect(art?.title).toBe('My Audio');
    expect(art?.kind).toBe(ArtifactType.AUDIO);
    expect(art?.status).toBe(ArtifactStatus.COMPLETED);
    expect(art?.createdAt).toBe(1_700_000_000 * 1000);
    expect(art?.url).toBe('https://lh3.googleusercontent.com/a.mp4');
  });

  it('reads the quiz/flashcard variant from slot 9', () => {
    const quiz = parseArtifact(row({ 0: 'q', 2: ArtifactTypeCode.QUIZ, 9: [null, [2]] }));
    expect(quiz?.kind).toBe(ArtifactType.QUIZ);
    const cards = parseArtifact(row({ 0: 'f', 2: ArtifactTypeCode.QUIZ, 9: [null, [1]] }));
    expect(cards?.kind).toBe(ArtifactType.FLASHCARDS);
  });

  it('returns null for malformed rows', () => {
    expect(parseArtifact(null)).toBeNull();
    expect(parseArtifact([])).toBeNull();
    expect(parseArtifact('nope')).toBeNull();
  });

  const promptCases: Array<[number, Record<number, unknown>, string]> = [
    [ArtifactTypeCode.AUDIO, { 6: [null, ['audio prompt']] }, 'audio prompt'],
    [
      ArtifactTypeCode.REPORT,
      { 7: [null, [null, null, null, null, null, 'report prompt']] },
      'report prompt',
    ],
    [ArtifactTypeCode.VIDEO, { 8: [null, null, [null, null, 'video prompt']] }, 'video prompt'],
    [ArtifactTypeCode.QUIZ, { 9: [null, [2, null, 'quiz prompt']] }, 'quiz prompt'],
    [ArtifactTypeCode.INFOGRAPHIC, { 14: [['infographic prompt']] }, 'infographic prompt'],
    [ArtifactTypeCode.SLIDE_DECK, { 16: [['slides prompt']] }, 'slides prompt'],
    [ArtifactTypeCode.DATA_TABLE, { 18: [null, ['table prompt']] }, 'table prompt'],
  ];

  it.each(promptCases)(
    'extracts the generation prompt for artifact type %s',
    (artifactType, slots, expected) => {
      const artifact = parseArtifact(row({ 0: 'a', 2: artifactType, ...slots }));
      expect(artifact?.generationPrompt).toBe(expected);
    },
  );

  it('leaves the prompt absent when the slot is missing or non-string', () => {
    expect(
      parseArtifact(row({ 0: 'a', 2: ArtifactTypeCode.AUDIO }))?.generationPrompt,
    ).toBeUndefined();
    expect(
      parseArtifact(row({ 0: 'a', 2: ArtifactTypeCode.AUDIO, 6: [null, [42]] }))?.generationPrompt,
    ).toBeUndefined();
  });
});

describe('parseMindMapArtifact', () => {
  it('parses a mind-map note row', () => {
    const data = ['mm-1', [null, null, [null, null, [1_650_000_000]], null, 'My Mind Map']];
    const art = parseMindMapArtifact(data);
    expect(art?.id).toBe('mm-1');
    expect(art?.title).toBe('My Mind Map');
    expect(art?.kind).toBe(ArtifactType.MIND_MAP);
    expect(art?.status).toBe(ArtifactStatus.COMPLETED);
    expect(art?.createdAt).toBe(1_650_000_000 * 1000);
  });

  it('returns null for a deleted mind map', () => {
    expect(parseMindMapArtifact(['mm-x', null, 2])).toBeNull();
  });
});

describe('extractArtifactUrl', () => {
  it('extracts the audio/mp4 url', () => {
    const data = row({
      6: [
        null,
        null,
        null,
        null,
        null,
        [['https://x.googleusercontent.com/a.mp4', 0, 'audio/mp4']],
      ],
    });
    expect(extractArtifactUrl(data, ArtifactTypeCode.AUDIO)).toBe(
      'https://x.googleusercontent.com/a.mp4',
    );
  });

  it('prefers the itag-4 video/mp4 url', () => {
    const data = row({
      8: [
        [
          ['https://x.googleusercontent.com/low.mp4', 1, 'video/mp4'],
          ['https://x.googleusercontent.com/hi.mp4', 4, 'video/mp4'],
        ],
      ],
    });
    expect(extractArtifactUrl(data, ArtifactTypeCode.VIDEO)).toBe(
      'https://x.googleusercontent.com/hi.mp4',
    );
  });

  it('extracts the slide-deck PDF url from slot 16', () => {
    const data = row({ 16: [null, null, null, 'https://x.googleusercontent.com/deck.pdf'] });
    expect(extractArtifactUrl(data, ArtifactTypeCode.SLIDE_DECK)).toBe(
      'https://x.googleusercontent.com/deck.pdf',
    );
  });

  it('returns undefined for non-media types', () => {
    expect(extractArtifactUrl(row({ 0: 'x' }), ArtifactTypeCode.REPORT)).toBeUndefined();
  });
});

describe('artifactMatchesType', () => {
  it('filters quiz vs flashcards by variant', () => {
    const quiz = parseArtifact(row({ 0: 'q', 2: ArtifactTypeCode.QUIZ, 9: [null, [2]] }))!;
    const cards = parseArtifact(row({ 0: 'f', 2: ArtifactTypeCode.QUIZ, 9: [null, [1]] }))!;
    expect(artifactMatchesType(quiz, ArtifactType.QUIZ)).toBe(true);
    expect(artifactMatchesType(quiz, ArtifactType.FLASHCARDS)).toBe(false);
    expect(artifactMatchesType(cards, ArtifactType.FLASHCARDS)).toBe(true);
  });

  it('matches everything when no filter is given', () => {
    const audio = parseArtifact(row({ 0: 'a', 2: ArtifactTypeCode.AUDIO }))!;
    expect(artifactMatchesType(audio, undefined)).toBe(true);
  });
});

describe('formatters', () => {
  it('extractAppData decodes the data-app-data attribute', () => {
    const html =
      '<div data-app-data="{&quot;quiz&quot;:[{&quot;question&quot;:&quot;Q1&quot;}]}"></div>';
    const data = extractAppData(html);
    expect(data).toEqual({ quiz: [{ question: 'Q1' }] });
  });

  it('formatQuizMarkdown renders questions and correct markers', () => {
    const md = formatQuizMarkdown('Quiz', [
      {
        question: 'What is 2+2?',
        answerOptions: [
          { text: '3', isCorrect: false },
          { text: '4', isCorrect: true },
        ],
      },
    ]);
    expect(md).toContain('# Quiz');
    expect(md).toContain('## Question 1');
    expect(md).toContain('- [ ] 3');
    expect(md).toContain('- [x] 4');
  });

  it('extractCellText concatenates nested text fragments', () => {
    expect(extractCellText([0, 1, [[2, 3, [['Hello']]]], ' World'])).toBe('Hello World');
  });

  it('parseDataTable extracts headers and rows from nested structure', () => {
    const rows = [
      [0, 1, ['Name', 'Age']],
      [1, 2, ['Alice', '30']],
    ];
    const raw = [[[[[null, null, null, null, [null, null, rows]]]]]];
    const { headers, rows: parsed } = parseDataTable(raw);
    expect(headers).toEqual(['Name', 'Age']);
    expect(parsed).toEqual([['Alice', '30']]);
  });

  it('toCsv escapes commas, quotes, and newlines', () => {
    const csv = toCsv(['a', 'b,c'], [['x', 'y"z']]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('a,"b,c"'); // header comma gets quoted
    expect(csv).toContain('x,"y""z"'); // plain cell stays bare; quote is doubled
  });
});

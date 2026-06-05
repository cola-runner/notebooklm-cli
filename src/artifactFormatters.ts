/**
 * Pure formatting helpers for interactive (quiz/flashcard) and data-table
 * artifacts. Ported from `notebooklm-py/src/notebooklm/_artifact_formatters.py`.
 */

import { ArtifactParseError } from './rpc/errors.js';

/** Decode HTML entities that appear in the `data-app-data` attribute. */
function htmlUnescape(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

interface QuizOption {
  text?: string;
  isCorrect?: boolean;
}
interface QuizQuestion {
  question?: string;
  answerOptions?: QuizOption[];
  hint?: string;
}
interface Flashcard {
  f?: string;
  b?: string;
}

/** Parsed shape of the quiz/flashcard `data-app-data` payload. */
export interface AppData {
  quiz?: QuizQuestion[];
  flashcards?: Flashcard[];
}

/** Extract embedded JSON from the quiz/flashcard HTML's `data-app-data` attribute. */
export function extractAppData(htmlContent: string): AppData {
  const match = /data-app-data="([^"]+)"/.exec(htmlContent);
  if (!match || !match[1]) {
    throw new ArtifactParseError('No data-app-data attribute found in quiz/flashcard HTML');
  }
  const decoded = htmlUnescape(match[1]);
  try {
    return JSON.parse(decoded) as AppData;
  } catch (err) {
    throw new ArtifactParseError('Failed to parse quiz/flashcard app data JSON', { cause: err });
  }
}

export function formatQuizMarkdown(title: string, questions: QuizQuestion[]): string {
  const lines: string[] = [`# ${title}`, ''];
  questions.forEach((q, i) => {
    lines.push(`## Question ${i + 1}`);
    lines.push(q.question ?? '');
    lines.push('');
    for (const opt of q.answerOptions ?? []) {
      const marker = opt.isCorrect ? '[x]' : '[ ]';
      lines.push(`- ${marker} ${opt.text ?? ''}`);
    }
    if (q.hint) {
      lines.push('');
      lines.push(`**Hint:** ${q.hint}`);
    }
    lines.push('');
  });
  return lines.join('\n');
}

export function formatFlashcardsMarkdown(title: string, cards: Flashcard[]): string {
  const lines: string[] = [`# ${title}`, ''];
  cards.forEach((card, i) => {
    lines.push(
      `## Card ${i + 1}`,
      '',
      `**Q:** ${card.f ?? ''}`,
      '',
      `**A:** ${card.b ?? ''}`,
      '',
      '---',
      '',
    );
  });
  return lines.join('\n');
}

export type InteractiveFormat = 'json' | 'markdown' | 'html';

/** Format parsed quiz/flashcard data as json, markdown, or raw html. */
export function formatInteractiveContent(
  appData: AppData,
  title: string,
  outputFormat: InteractiveFormat,
  htmlContent: string,
  isQuiz: boolean,
): string {
  if (outputFormat === 'html') return htmlContent;

  if (isQuiz) {
    const questions = appData.quiz ?? [];
    if (outputFormat === 'markdown') return formatQuizMarkdown(title, questions);
    return JSON.stringify({ title, questions }, null, 2);
  }

  const cards = appData.flashcards ?? [];
  if (outputFormat === 'markdown') return formatFlashcardsMarkdown(title, cards);
  const normalized = cards.map((c) => ({ front: c.f ?? '', back: c.b ?? '' }));
  return JSON.stringify({ title, cards: normalized }, null, 2);
}

/** Recursively concatenate text fragments from a nested data-table cell. */
export function extractCellText(cell: unknown): string {
  if (typeof cell === 'string') return cell;
  if (typeof cell === 'number') return '';
  if (Array.isArray(cell)) return cell.map(extractCellText).join('');
  return '';
}

/** Navigate to the rows array inside a data-table artifact's slot-18 payload. */
export function extractDataTableRows(rawData: unknown): unknown[] {
  let node: unknown = rawData;
  for (const idx of [0, 0, 0, 0, 4, 2]) {
    if (!Array.isArray(node)) return [];
    node = node[idx];
  }
  return Array.isArray(node) ? node : [];
}

/**
 * Parse a rich-text data table into headers + rows. The first row is the
 * header. Throws ArtifactParseError on empty/unusable structures.
 */
export function parseDataTable(rawData: unknown): { headers: string[]; rows: string[][] } {
  const rowsArray = extractDataTableRows(rawData);
  if (rowsArray.length === 0) {
    throw new ArtifactParseError('Empty data table');
  }

  let headers: string[] = [];
  const rows: string[][] = [];
  rowsArray.forEach((rowSection, i) => {
    if (!Array.isArray(rowSection) || rowSection.length < 3) return;
    const cellArray = rowSection[2];
    if (!Array.isArray(cellArray)) return;
    const rowValues = cellArray.map(extractCellText);
    if (i === 0) headers = rowValues;
    else rows.push(rowValues);
  });

  if (headers.length === 0) {
    throw new ArtifactParseError('Failed to extract headers from data table');
  }
  return { headers, rows };
}

/** Serialize headers + rows to CSV (with UTF-8 BOM, matching the py CLI output). */
export function toCsv(headers: string[], rows: string[][]): string {
  const escapeCell = (v: string): string => {
    if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCell).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

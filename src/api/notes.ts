/**
 * Notes API — user-created notes within a notebook (distinct from artifacts).
 *
 * Ported from `notebooklm-py/src/notebooklm/_note_service.py` + `_notes.py`.
 * Notes and mind maps share one wire collection (`GET_NOTES_AND_MIND_MAPS`);
 * this API returns only plain text notes, filtering out deleted rows
 * (`[id, null, 2]`) and mind-map rows (content JSON with `"children":`/`"nodes":`).
 */

import type { Session } from '../session/session.js';
import type { Note } from '../types.js';

export class NotesAPI {
  constructor(private readonly session: Session) {}

  /** List all text notes (excludes deleted notes and mind maps). */
  async list(notebookId: string): Promise<Note[]> {
    const rows = await this.fetchRows(notebookId);
    const notes: Note[] = [];
    for (const row of rows) {
      if (!Array.isArray(row) || row.length === 0) continue;
      if (isDeletedRow(row) || isMindMapRow(row)) continue;
      notes.push(parseNote(row, notebookId));
    }
    return notes;
  }

  /** Get a single note by id, or undefined if not present. */
  async get(notebookId: string, noteId: string): Promise<Note | undefined> {
    const rows = await this.fetchRows(notebookId);
    for (const row of rows) {
      if (Array.isArray(row) && row.length > 0 && row[0] === noteId) {
        return parseNote(row, notebookId);
      }
    }
    return undefined;
  }

  /**
   * Create a note. CREATE_NOTE persists an empty row and ignores the title /
   * content server-side, so we follow up with UPDATE_NOTE to set both.
   */
  async create(notebookId: string, title = 'New Note', content = ''): Promise<Note> {
    const result = await this.session.call<unknown>(
      'CREATE_NOTE',
      [notebookId, '', [1], null, title],
      { allowNull: true },
    );

    let noteId = '';
    if (Array.isArray(result) && result.length > 0) {
      const first = result[0];
      if (Array.isArray(first) && typeof first[0] === 'string') noteId = first[0];
      else if (typeof first === 'string') noteId = first;
    }

    if (noteId) await this.update(notebookId, noteId, content, title);
    return { id: noteId, notebookId, title, content };
  }

  /** Update a note's content and title in place. */
  async update(notebookId: string, noteId: string, content: string, title: string): Promise<void> {
    await this.session.call('UPDATE_NOTE', [notebookId, noteId, [[[content, title, [], 0]]]], {
      allowNull: true,
    });
  }

  /** Soft-delete a note (clears content/title; the id may persist server-side). */
  async delete(notebookId: string, noteId: string): Promise<boolean> {
    await this.session.call('DELETE_NOTE', [notebookId, null, [noteId]], { allowNull: true });
    return true;
  }

  /** Fetch the raw notes + mind-maps rows for a notebook. */
  private async fetchRows(notebookId: string): Promise<unknown[]> {
    const result = await this.session.call<unknown>('GET_NOTES_AND_MIND_MAPS', [notebookId], {
      allowNull: true,
    });
    // Shape: [[...rows]] — the inner list holds the rows.
    if (Array.isArray(result) && result.length > 0 && Array.isArray(result[0])) {
      return result[0];
    }
    return Array.isArray(result) ? result : [];
  }
}

/** A deleted row is `[id, null, 2]` — null content + soft-delete sentinel. */
function isDeletedRow(row: unknown[]): boolean {
  return row.length >= 3 && row[1] === null && row[2] === 2;
}

/** Mind-map rows carry content JSON with `"children":` or `"nodes":` keys. */
function isMindMapRow(row: unknown[]): boolean {
  const content = extractContent(row);
  return !!content && (content.includes('"children":') || content.includes('"nodes":'));
}

/** The JSON content payload of a row: `row[1]` (legacy) or `row[1][1]` (current). */
function extractContent(row: unknown[]): string | undefined {
  if (row.length <= 1) return undefined;
  if (typeof row[1] === 'string') return row[1];
  if (Array.isArray(row[1]) && row[1].length > 1 && typeof row[1][1] === 'string') return row[1][1];
  return undefined;
}

/** Parse a note row into a Note. Handles legacy `[id, content]` and current
 *  `[id, [id, content, meta, null, title]]` shapes. */
function parseNote(row: unknown[], notebookId: string): Note {
  const id = typeof row[0] === 'string' ? row[0] : String(row[0] ?? '');
  let content = '';
  let title = '';
  const inner = row[1];
  if (typeof inner === 'string') {
    content = inner;
  } else if (Array.isArray(inner)) {
    if (typeof inner[1] === 'string') content = inner[1];
    if (inner.length > 4 && typeof inner[4] === 'string') title = inner[4];
  }
  return { id, notebookId, title, content };
}

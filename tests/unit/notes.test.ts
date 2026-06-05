/**
 * Regression guards for the notes wire protocol + row classification.
 *
 * Verified live against the SpaceX notebook (create→list→get→update→delete);
 * these pin the RPC params and the row shapes so they can't silently drift.
 */

import { describe, expect, it } from 'vitest';
import { NotesAPI } from '../../src/api/notes.js';
import type { Session } from '../../src/session/session.js';

interface Call {
  method: string;
  params: unknown[];
}

/** NotesAPI whose session.call records calls and replays queued responses. */
function makeNotes(responses: Record<string, unknown>): {
  notes: NotesAPI;
  calls: Call[];
} {
  const calls: Call[] = [];
  const session = {
    call: async (method: string, params: unknown[]) => {
      calls.push({ method, params });
      return responses[method] ?? null;
    },
  } as unknown as Session;
  return { notes: new NotesAPI(session), calls };
}

describe('NotesAPI.list', () => {
  it('parses notes and filters deleted + mind-map rows', async () => {
    const rows = [
      ['note-1', ['note-1', 'plain content', null, null, 'My Note']],
      ['deleted-1', null, 2], // soft-deleted
      ['mm-1', ['mm-1', '{"nodes":[]}', null, null, 'Mind Map']], // mind map
      ['note-2', 'legacy-string-content'], // legacy shape, no title
    ];
    const { notes } = makeNotes({ GET_NOTES_AND_MIND_MAPS: [rows] });
    const result = await notes.list('nb');
    expect(result.map((n) => n.id)).toEqual(['note-1', 'note-2']);
    expect(result[0]).toEqual({
      id: 'note-1',
      notebookId: 'nb',
      title: 'My Note',
      content: 'plain content',
    });
    expect(result[1]?.content).toBe('legacy-string-content');
  });
});

describe('NotesAPI.create', () => {
  it('sends CREATE_NOTE then UPDATE_NOTE with the right params', async () => {
    const { notes, calls } = makeNotes({ CREATE_NOTE: [['new-id']] });
    const note = await notes.create('nb', 'Title', 'Body');
    expect(note).toEqual({ id: 'new-id', notebookId: 'nb', title: 'Title', content: 'Body' });
    expect(calls[0]).toEqual({ method: 'CREATE_NOTE', params: ['nb', '', [1], null, 'Title'] });
    expect(calls[1]).toEqual({
      method: 'UPDATE_NOTE',
      params: ['nb', 'new-id', [[['Body', 'Title', [], 0]]]],
    });
  });
});

describe('NotesAPI.delete', () => {
  it('sends DELETE_NOTE with [notebookId, null, [noteId]]', async () => {
    const { notes, calls } = makeNotes({});
    await expect(notes.delete('nb', 'note-9')).resolves.toBe(true);
    expect(calls[0]).toEqual({ method: 'DELETE_NOTE', params: ['nb', null, ['note-9']] });
  });
});

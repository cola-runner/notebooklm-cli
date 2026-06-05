/**
 * Notebook operations API.
 *
 * Ported (minimal subset) from `notebooklm-py/src/notebooklm/_notebooks.py`.
 */

import type { Session } from '../session/session.js';
import { type Notebook, parseNotebook } from '../types.js';

export class NotebooksAPI {
  constructor(private readonly session: Session) {}

  /** List all notebooks accessible to the authed user. */
  async list(): Promise<Notebook[]> {
    const result = await this.session.call<unknown>('LIST_NOTEBOOKS', [null, 1, null, [2]]);
    if (!Array.isArray(result) || result.length === 0) return [];
    const first = result[0];
    const raw = Array.isArray(first) ? first : result;
    return raw.map((nb) => parseNotebook(nb));
  }

  /** Create a new notebook with the given title. */
  async create(title: string): Promise<Notebook> {
    const result = await this.session.call<unknown>('CREATE_NOTEBOOK', [
      title,
      null,
      null,
      [2],
      [1],
    ]);
    return parseNotebook(result);
  }

  /** Fetch a notebook by id. Throws if not found. */
  async get(notebookId: string): Promise<Notebook> {
    const result = await this.session.call<unknown>('GET_NOTEBOOK', [
      notebookId,
      null,
      [2],
      null,
      0,
    ]);
    const nbInfo = Array.isArray(result) && result.length > 0 ? result[0] : [];
    if (!Array.isArray(nbInfo) || nbInfo.length === 0) {
      throw new Error(`Notebook not found: ${notebookId}`);
    }
    const nb = parseNotebook(nbInfo);
    if (!nb.id && !nb.title) {
      throw new Error(`Notebook not found: ${notebookId}`);
    }
    return nb;
  }

  /**
   * Extract all source IDs from a notebook. Used by artifact/chat generation
   * when no explicit `sourceIds` are passed (defaults to "all sources").
   *
   * Source IDs are triple-nested in GET_NOTEBOOK responses: `source[0][0]`.
   * Returns an empty array on shape drift rather than throwing.
   */
  async getSourceIds(notebookId: string): Promise<string[]> {
    const result = await this.session.call<unknown>('GET_NOTEBOOK', [
      notebookId,
      null,
      [2],
      null,
      0,
    ]);
    if (!Array.isArray(result) || result.length === 0) return [];
    const nbInfo = result[0];
    if (!Array.isArray(nbInfo) || nbInfo.length <= 1 || !Array.isArray(nbInfo[1])) return [];
    const ids: string[] = [];
    for (const source of nbInfo[1]) {
      if (!Array.isArray(source) || source.length === 0) continue;
      const first = source[0];
      if (!Array.isArray(first) || first.length === 0) continue;
      const sid = first[0];
      if (typeof sid === 'string') ids.push(sid);
    }
    return ids;
  }

  /** Delete a notebook by id. Returns true on success. */
  async delete(notebookId: string): Promise<boolean> {
    await this.session.call('DELETE_NOTEBOOK', [[notebookId], [2]], { allowNull: true });
    return true;
  }

  /** Rename a notebook and return the updated record. */
  async rename(notebookId: string, newTitle: string): Promise<Notebook> {
    await this.session.call(
      'RENAME_NOTEBOOK',
      [notebookId, [[null, null, null, [null, newTitle]]]],
      { allowNull: true },
    );
    return this.get(notebookId);
  }
}

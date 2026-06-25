/**
 * Notebook operations API.
 *
 * Ported (minimal subset) from `notebooklm-py/src/notebooklm/_notebooks.py`.
 */

import { nestSourceIds } from '../rpc/encoder.js';
import type { Session } from '../session/session.js';
import { type Notebook, type PromptSuggestion, parseNotebook } from '../types.js';

/** Default + bounds for the SUGGEST_PROMPTS "mode/surface" selector. */
export const SUGGEST_PROMPTS_DEFAULT_MODE = 4;
export const SUGGEST_PROMPTS_MODE_MIN = 1;
export const SUGGEST_PROMPTS_MODE_MAX = 9;

export interface SuggestPromptsOptions {
  /** Scope suggestions to these source ids; omitted → all of the notebook's sources. */
  sourceIds?: string[];
  /**
   * The required "mode/surface" selector (1..9). It picks which product surface
   * the prompts are written for: 4 (default) = chat questions, 5 = critique,
   * 6 = audio/debate, 8 = quiz, 9 = flashcards; 1-3 and 7 track 4. The values
   * are live-verified but Google's member names are unknown, so it stays a plain
   * int (per notebooklm-py). 0 / out-of-range makes the server error.
   */
  mode?: number;
  /** Optional free-text steer; empty/whitespace is treated as no steer. */
  query?: string;
}

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

  /**
   * Get AI-suggested prompts for a notebook (SUGGEST_PROMPTS / otmP3b). With the
   * default `mode=4` these are chat questions to feed `chat.ask`; other modes
   * target other surfaces (see `SuggestPromptsOptions.mode`). Best-effort UI
   * sugar: a degenerate response yields `[]` rather than throwing.
   *
   * Ported from notebooklm-py `NotebooksAPI.suggest_prompts`.
   */
  async suggestPrompts(
    notebookId: string,
    opts: SuggestPromptsOptions = {},
  ): Promise<PromptSuggestion[]> {
    const mode = opts.mode ?? SUGGEST_PROMPTS_DEFAULT_MODE;
    const sourceIds = opts.sourceIds ?? (await this.getSourceIds(notebookId));
    const params = buildSuggestPromptsParams(notebookId, sourceIds, mode, opts.query);
    const result = await this.session.call<unknown>('SUGGEST_PROMPTS', params, { allowNull: true });
    return parsePromptSuggestions(result);
  }
}

/**
 * Build SUGGEST_PROMPTS params. Positional shape (live-verified upstream):
 * `[ctx, notebookId, [[sid], …], mode, null, query]`. Throws on an out-of-range
 * mode before any network call.
 */
export function buildSuggestPromptsParams(
  notebookId: string,
  sourceIds: string[],
  mode: number,
  query?: string,
): unknown[] {
  if (
    !Number.isInteger(mode) ||
    mode < SUGGEST_PROMPTS_MODE_MIN ||
    mode > SUGGEST_PROMPTS_MODE_MAX
  ) {
    throw new Error(
      `mode must be an integer in ${SUGGEST_PROMPTS_MODE_MIN}..${SUGGEST_PROMPTS_MODE_MAX}, got ${mode}`,
    );
  }
  // An empty/whitespace-only steer carries no signal — normalise to null.
  const resolvedQuery = query?.trim() ? query : null;
  const ctx = [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]]];
  return [ctx, notebookId, nestSourceIds(sourceIds, 1), mode, null, resolvedQuery];
}

/**
 * Parse a SUGGEST_PROMPTS reply. The rows are wrapped one level deep:
 * `[[ [title, prompt], … ]]`. Missing/short rows degrade to empty strings; a
 * degenerate payload yields `[]`. Rows carrying neither title nor prompt are
 * dropped.
 */
export function parsePromptSuggestions(result: unknown): PromptSuggestion[] {
  if (!Array.isArray(result) || result.length === 0) return [];
  const rows = result[0];
  if (!Array.isArray(rows)) return [];
  const out: PromptSuggestion[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const title = typeof row[0] === 'string' ? row[0] : '';
    const prompt = typeof row[1] === 'string' ? row[1] : '';
    if (title || prompt) out.push({ title, prompt });
  }
  return out;
}

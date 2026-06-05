/**
 * Source operations API — add/list/delete/wait sources within a notebook.
 *
 * Ported (minimal subset) from `notebooklm-py/src/notebooklm/_sources.py` +
 * `_source_add.py` + `_source_listing.py`.
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { SourceStatus } from '../rpc/types.js';
import type { Session } from '../session/session.js';
import { type Source, parseSource } from '../types.js';
import { isYoutubeUrl } from '../urlUtils.js';

const TERMINAL_STATUSES = new Set<number>([SourceStatus.READY, SourceStatus.ERROR]);

export class SourcesAPI {
  constructor(private readonly session: Session) {}

  /** List all sources in a notebook. */
  async list(notebookId: string): Promise<Source[]> {
    const notebook = await this.session.call<unknown>('GET_NOTEBOOK', [
      notebookId,
      null,
      [2],
      null,
      0,
    ]);
    if (!Array.isArray(notebook) || notebook.length === 0) return [];
    const nbInfo = notebook[0];
    if (!Array.isArray(nbInfo) || nbInfo.length <= 1) return [];
    const sourcesList = nbInfo[1];
    if (!Array.isArray(sourcesList)) return [];
    return sourcesList.map((s) => parseSource(s)).filter((s): s is Source => s !== null);
  }

  /** Get a source by id (returns undefined if not present). */
  async get(notebookId: string, sourceId: string): Promise<Source | undefined> {
    const sources = await this.list(notebookId);
    return sources.find((s) => s.id === sourceId);
  }

  /**
   * Add a URL source. Auto-detects YouTube URLs and uses the YouTube variant.
   *
   * Returns the new source id parsed from the response; the source may still
   * be PROCESSING. Use `waitUntilReady` to block until it's queryable.
   */
  async addUrl(notebookId: string, url: string): Promise<Source> {
    const params = isYoutubeUrl(url)
      ? this.buildYoutubeParams(notebookId, url)
      : this.buildUrlParams(notebookId, url);
    const result = await this.session.call<unknown>('ADD_SOURCE', params);
    const source = parseAddSourceResult(result);
    if (!source) {
      throw new Error(`Failed to parse ADD_SOURCE response for ${url}`);
    }
    return source;
  }

  /** Add a text/snippet source with the given title + body. */
  async addText(notebookId: string, title: string, content: string): Promise<Source> {
    const params = [
      [[null, [title, content], null, null, null, null, null, null]],
      notebookId,
      [2],
      null,
      null,
    ];
    const result = await this.session.call<unknown>('ADD_SOURCE', params);
    const source = parseAddSourceResult(result);
    if (!source) {
      throw new Error(`Failed to parse ADD_SOURCE response for text "${title}"`);
    }
    return source;
  }

  /** Delete a source from a notebook. Returns true on success. */
  async delete(notebookId: string, sourceId: string): Promise<boolean> {
    await this.session.call('DELETE_SOURCE', [[[sourceId]]], { allowNull: true });
    void notebookId; // notebook id is not part of the wire params, retained for symmetry
    return true;
  }

  /**
   * Poll until a source reaches READY or ERROR (terminal). Throws on timeout
   * or ERROR status.
   */
  async waitUntilReady(
    notebookId: string,
    sourceId: string,
    opts: { timeoutMs?: number; initialIntervalMs?: number; maxIntervalMs?: number } = {},
  ): Promise<Source> {
    const timeoutMs = opts.timeoutMs ?? 120_000;
    const initialMs = opts.initialIntervalMs ?? 1_000;
    const maxMs = opts.maxIntervalMs ?? 10_000;
    const deadline = Date.now() + timeoutMs;
    let interval = initialMs;
    while (Date.now() < deadline) {
      const source = await this.get(notebookId, sourceId);
      if (source && TERMINAL_STATUSES.has(source.status)) {
        if (source.status === SourceStatus.ERROR) {
          throw new Error(`Source ${sourceId} processing failed (status=ERROR)`);
        }
        return source;
      }
      await sleep(interval);
      interval = Math.min(maxMs, Math.floor(interval * 1.5));
    }
    throw new Error(`Source ${sourceId} did not reach READY within ${timeoutMs}ms`);
  }

  // -------------------------------------------------------------------------

  private buildUrlParams(notebookId: string, url: string): unknown[] {
    return [[[null, null, [url], null, null, null, null, null]], notebookId, [2], null, null];
  }

  private buildYoutubeParams(notebookId: string, url: string): unknown[] {
    return [
      [[null, null, null, null, null, null, null, [url], null, null, 1]],
      notebookId,
      [2],
      [1, null, null, null, null, null, null, null, null, null, [1]],
    ];
  }
}

/**
 * ADD_SOURCE returns the new source row in the same shape as a list entry.
 * The exact nesting varies by source type; we try a handful of likely
 * positions before giving up.
 */
function parseAddSourceResult(result: unknown): Source | null {
  if (!Array.isArray(result)) return null;
  // Try direct parse first
  let parsed = parseSource(result);
  if (parsed) return parsed;
  // Try result[0] (common wrap)
  parsed = parseSource(result[0]);
  if (parsed) return parsed;
  // Try result[0][0] (deeply wrapped)
  const inner = Array.isArray(result[0]) ? result[0][0] : undefined;
  if (inner) {
    parsed = parseSource(inner);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Source operations API — add/list/delete/wait sources within a notebook.
 *
 * Ported (minimal subset) from `notebooklm-py/src/notebooklm/_sources.py` +
 * `_source_add.py` + `_source_listing.py`.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { request } from 'undici';
import { baseHeaders } from '../auth/headers.js';
import { AuthError } from '../rpc/errors.js';
import { SourceStatus, getUploadUrl } from '../rpc/types.js';
import type { Session } from '../session/session.js';
import { type Source, parseSource } from '../types.js';
import { isYoutubeUrl } from '../urlUtils.js';
import {
  assertUploadFileSupported,
  buildRegisterFileParams,
  buildUploadStartBody,
  extractFileSourceId,
  guessUploadContentType,
  validateResumableUploadUrl,
} from './sourceUpload.js';

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

  /**
   * Add a local file (PDF, image, docx, audio, …) as a source via Google's
   * resumable upload, so NotebookLM ingests the real bytes natively.
   *
   * Three steps: register the source (ADD_SOURCE_FILE → SOURCE_ID), open a
   * resumable upload session, then stream the bytes to it. Returns the new
   * source, which may still be PROCESSING — use `waitUntilReady` to block.
   *
   * @throws on a missing/non-regular file, an unsupported type (HTML), or a
   *   protocol failure. The file is streamed, never buffered whole.
   */
  async addFile(
    notebookId: string,
    filePath: string,
    opts: { mime?: string } = {},
  ): Promise<Source> {
    const resolved = resolve(filePath);
    const stats = await stat(resolved);
    if (!stats.isFile()) throw new Error(`Not a regular file: ${resolved}`);
    const filename = basename(resolved);
    const contentType = guessUploadContentType(filename, opts.mime);
    assertUploadFileSupported(filename, contentType);

    const sourceId = await this.registerFileSource(notebookId, filename);
    const uploadUrl = await this.startResumableUpload(
      notebookId,
      filename,
      stats.size,
      sourceId,
      contentType,
    );
    await this.uploadBytes(uploadUrl, resolved, stats.size);

    return { id: sourceId, title: filename, status: SourceStatus.PROCESSING };
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

  /**
   * Register a file-source intent and resolve its SOURCE_ID. ADD_SOURCE_FILE is
   * scoped to `/notebook/<id>` (not the default `/`). If the response carries no
   * trustworthy id, probe the source list once for a freshly-titled match.
   */
  private async registerFileSource(notebookId: string, filename: string): Promise<string> {
    const result = await this.session.call<unknown>(
      'ADD_SOURCE_FILE',
      buildRegisterFileParams(filename, notebookId),
      { sourcePath: `/notebook/${notebookId}` },
    );
    const sourceId = extractFileSourceId(result, filename);
    if (sourceId) return sourceId;

    const matches = (await this.list(notebookId)).filter((s) => s.title === filename);
    if (matches.length === 1) return matches[0]!.id;
    throw new Error(
      `ADD_SOURCE_FILE returned no usable SOURCE_ID for "${filename}" and the source-list probe was inconclusive. Check the notebook before retrying.`,
    );
  }

  /** Open a Scotty resumable-upload session; returns the validated upload URL. */
  private async startResumableUpload(
    notebookId: string,
    filename: string,
    fileSize: number,
    sourceId: string,
    contentType: string,
  ): Promise<string> {
    const res = await request(`${getUploadUrl()}?authuser=0`, {
      method: 'POST',
      headers: {
        ...baseHeaders(),
        Accept: '*/*',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'x-goog-authuser': '0',
        'x-goog-upload-command': 'start',
        'x-goog-upload-header-content-length': String(fileSize),
        'x-goog-upload-header-content-type': contentType,
        'x-goog-upload-protocol': 'resumable',
        Cookie: this.session.transport.cookieHeader(),
      },
      body: buildUploadStartBody(notebookId, filename, sourceId),
    });
    await res.body.text(); // drain
    if (res.statusCode === 401 || res.statusCode === 403) {
      throw new AuthError(`Upload session start rejected (HTTP ${res.statusCode}).`);
    }
    if (res.statusCode >= 400) {
      throw new Error(`Failed to start upload session (HTTP ${res.statusCode}) for ${filename}`);
    }
    const header = res.headers['x-goog-upload-url'];
    const uploadUrl = Array.isArray(header) ? header[0] : header;
    if (!uploadUrl) throw new Error('Upload start response carried no x-goog-upload-url header');
    return validateResumableUploadUrl(uploadUrl);
  }

  /** Stream the file bytes to the resumable session and finalize in one POST. */
  private async uploadBytes(uploadUrl: string, filePath: string, fileSize: number): Promise<void> {
    const res = await request(uploadUrl, {
      method: 'POST',
      headers: {
        ...baseHeaders(),
        Accept: '*/*',
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        'x-goog-authuser': '0',
        'x-goog-upload-command': 'upload, finalize',
        'x-goog-upload-offset': '0',
        'Content-Length': String(fileSize),
        Cookie: this.session.transport.cookieHeader(),
      },
      body: createReadStream(filePath),
    });
    await res.body.text(); // drain
    if (res.statusCode >= 400) {
      throw new Error(`File upload finalize failed (HTTP ${res.statusCode})`);
    }
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

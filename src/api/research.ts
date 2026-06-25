/**
 * Research API — web/drive discovery sessions.
 *
 * Ported from `notebooklm-py/src/notebooklm/_research.py`. Flow: `start` kicks
 * off a fast or deep research task, `poll` (or `waitForResults`) returns the
 * discovered sources + summary, and `importSources` pulls selected sources
 * into the notebook.
 */

import { setTimeout as sleep } from 'node:timers/promises';
import type { Session } from '../session/session.js';
import type { ResearchPollResult, ResearchSource, ResearchStart, ResearchTask } from '../types.js';

const RESULT_TYPE_ALIASES: Record<string, number> = { web: 1, drive: 2, report: 5 };

export interface StartResearchOptions {
  /** "web" (default) or "drive". */
  source?: 'web' | 'drive';
  /** "fast" (default) or "deep" (web only). */
  mode?: 'fast' | 'deep';
}

export interface WaitForResultsOptions {
  timeoutMs?: number;
  intervalMs?: number;
  onStatus?: (status: string) => void;
}

export class ResearchAPI {
  constructor(private readonly session: Session) {}

  /** Start a research session. Returns the task handle, or null if rejected. */
  async start(
    notebookId: string,
    query: string,
    opts: StartResearchOptions = {},
  ): Promise<ResearchStart | null> {
    const source = (opts.source ?? 'web').toLowerCase();
    const mode = (opts.mode ?? 'fast').toLowerCase();
    if (source !== 'web' && source !== 'drive') {
      throw new Error(`Invalid source '${opts.source}'. Use 'web' or 'drive'.`);
    }
    if (mode !== 'fast' && mode !== 'deep') {
      throw new Error(`Invalid mode '${opts.mode}'. Use 'fast' or 'deep'.`);
    }
    if (mode === 'deep' && source === 'drive') {
      throw new Error('Deep Research only supports Web sources.');
    }

    const sourceType = source === 'web' ? 1 : 2;
    let method: 'START_FAST_RESEARCH' | 'START_DEEP_RESEARCH';
    let params: unknown[];
    if (mode === 'fast') {
      method = 'START_FAST_RESEARCH';
      params = [[query, sourceType], null, 1, notebookId];
    } else {
      method = 'START_DEEP_RESEARCH';
      params = [null, [1], [query, sourceType], 5, notebookId];
    }

    const result = await this.session.call<unknown>(method, params, { allowNull: true });
    if (!Array.isArray(result) || result.length === 0 || typeof result[0] !== 'string') {
      return null;
    }
    const out: ResearchStart = {
      taskId: result[0],
      notebookId,
      query,
      mode: mode as 'fast' | 'deep',
    };
    if (typeof result[1] === 'string') out.reportId = result[1];
    return out;
  }

  /** Poll for research results. Pass `taskId` to disambiguate concurrent tasks. */
  async poll(notebookId: string, taskId?: string): Promise<ResearchPollResult> {
    const raw = await this.session.call<unknown>('POLL_RESEARCH', [null, null, notebookId], {
      allowNull: true,
    });
    if (!Array.isArray(raw) || raw.length === 0)
      return { status: 'no_research', sources: [], tasks: [] };

    // Unwrap one level if the tasks are nested under raw[0].
    let rows: unknown[] = raw;
    if (Array.isArray(raw[0]) && raw[0].length > 0 && Array.isArray(raw[0][0])) {
      rows = raw[0];
    }

    let tasks: ResearchTask[] = [];
    for (const taskData of rows) {
      const parsed = this.parseTask(taskData);
      if (parsed) tasks.push(parsed);
    }

    if (taskId !== undefined) tasks = tasks.filter((t) => t.taskId === taskId);

    if (tasks.length === 0) return { status: 'no_research', sources: [], tasks: [] };
    const selected = tasks[0]!;
    return { ...selected, tasks };
  }

  /**
   * Poll until the (single) research task completes or the timeout elapses.
   * Returns the final poll result (status may still be in_progress on timeout).
   */
  async waitForResults(
    notebookId: string,
    taskId: string,
    opts: WaitForResultsOptions = {},
  ): Promise<ResearchPollResult> {
    const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60 * 1000);
    const interval = opts.intervalMs ?? 5_000;
    let last = await this.poll(notebookId, taskId);
    opts.onStatus?.(last.status);
    // Keep waiting while the task is running OR not yet visible — right after
    // start() the task can take a poll or two to surface under POLL_RESEARCH,
    // so "no_research" is not terminal here. Only "completed" stops the loop.
    while (last.status !== 'completed' && Date.now() < deadline) {
      await sleep(interval);
      last = await this.poll(notebookId, taskId);
      opts.onStatus?.(last.status);
    }
    return last;
  }

  /**
   * Import selected research sources into the notebook. Web sources need a
   * `url`; deep-research report entries (resultType 5) need `reportMarkdown`.
   * Returns the imported `{ id, title }` rows (the API may under-report —
   * re-list sources to confirm).
   */
  async importSources(
    notebookId: string,
    taskId: string,
    sources: ResearchSource[],
  ): Promise<Array<{ id: string; title: string }>> {
    if (sources.length === 0) return [];

    for (const s of sources) {
      if (s.researchTaskId && s.researchTaskId !== taskId) {
        throw new Error(
          `Source research_task_id ${s.researchTaskId} does not match task ${taskId}.`,
        );
      }
    }

    const reportSources = sources.filter(
      (s) => s.resultType === 5 && typeof s.title === 'string' && !!s.reportMarkdown,
    );
    const reportSet = new Set(reportSources);
    const webSources = sources.filter((s) => s.url && !reportSet.has(s));
    if (webSources.length === 0 && reportSources.length === 0) return [];

    const sourceArray: unknown[] = [];
    for (const r of reportSources) {
      sourceArray.push([
        null,
        [r.title, r.reportMarkdown],
        null,
        3,
        null,
        null,
        null,
        null,
        null,
        null,
        3,
      ]);
    }
    for (const w of webSources) {
      sourceArray.push([
        null,
        null,
        [w.url, w.title || 'Untitled'],
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        2,
      ]);
    }

    const params = [null, [1], taskId, notebookId, sourceArray];
    const result = await this.session.call<unknown>('IMPORT_RESEARCH', params, { allowNull: true });

    let rows: unknown[] = Array.isArray(result) ? result : [];
    if (
      rows.length > 0 &&
      Array.isArray(rows[0]) &&
      rows[0].length > 0 &&
      Array.isArray(rows[0][0])
    ) {
      rows = rows[0];
    }
    const imported: Array<{ id: string; title: string }> = [];
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const id = Array.isArray(row[0]) && typeof row[0][0] === 'string' ? row[0][0] : undefined;
      if (id) imported.push({ id, title: typeof row[1] === 'string' ? row[1] : '' });
    }
    return imported;
  }

  /**
   * Cancel an in-flight research run. Fire-and-forget: the server returns an
   * empty payload unconditionally and does NOT validate `runId`, so this never
   * raises on an unknown id and carries no success signal — `poll` afterward to
   * confirm (a cancelled in-progress run surfaces as completed/failed shortly).
   *
   * `notebookId` is routing context only (sets `source-path`), not an auth
   * boundary — the server keys the cancel solely on `runId`. Pass the run's
   * `taskId` from `poll`/`start` as `runId`. Ported from notebooklm-py `cancel()`.
   */
  async cancel(notebookId: string, runId: string): Promise<void> {
    await this.session.call('CANCEL_RESEARCH', [null, null, runId], {
      allowNull: true,
      sourcePath: `/notebook/${notebookId}`,
    });
  }

  /** Parse one task row `[taskId, taskInfo]` into a ResearchTask. */
  private parseTask(taskData: unknown): ResearchTask | null {
    if (!Array.isArray(taskData)) return null;
    const taskId = typeof taskData[0] === 'string' ? taskData[0] : null;
    const taskInfo = Array.isArray(taskData[1]) ? taskData[1] : null;
    if (taskId === null || taskInfo === null) return null;

    const query =
      Array.isArray(taskInfo[1]) && typeof taskInfo[1][0] === 'string' ? taskInfo[1][0] : '';
    const statusCode =
      typeof taskInfo[4] === 'number' && !Number.isNaN(taskInfo[4]) ? taskInfo[4] : null;

    const bundle = Array.isArray(taskInfo[3]) ? taskInfo[3] : [];
    const sourcesData = Array.isArray(bundle[0]) ? bundle[0] : [];
    const summary = typeof bundle[1] === 'string' ? bundle[1] : '';

    const sources: ResearchSource[] = [];
    let report = '';
    for (const src of sourcesData) {
      if (!Array.isArray(src) || src.length < 2) continue;
      let title = '';
      let url = '';
      let sourceReport = '';
      let resultType: number | string = src.length > 3 ? this.parseResultType(src[3]) : 1;

      if (src[0] === null && src.length > 1) {
        if (
          Array.isArray(src[1]) &&
          src[1].length >= 2 &&
          typeof src[1][0] === 'string' &&
          typeof src[1][1] === 'string'
        ) {
          title = src[1][0];
          sourceReport = src[1][1];
          if (resultType === 1) resultType = 5;
        } else if (typeof src[1] === 'string') {
          title = src[1];
          if (resultType === 1) resultType = 5;
        }
      } else if (typeof src[0] === 'string' || src.length >= 3) {
        url = typeof src[0] === 'string' ? src[0] : '';
        title = typeof src[1] === 'string' ? src[1] : '';
      }

      if (title || url) {
        const s: ResearchSource = { url, title, resultType, researchTaskId: taskId };
        if (sourceReport) s.reportMarkdown = sourceReport;
        sources.push(s);
      }
      if (!report && sourceReport) report = sourceReport;
      else if (!report) {
        report = extractLegacyReportChunks(src);
      }
    }

    return {
      taskId,
      status: statusCode === 2 || statusCode === 6 ? 'completed' : 'in_progress',
      query,
      sources,
      summary,
      report,
    };
  }

  private parseResultType(value: unknown): number | string {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return RESULT_TYPE_ALIASES[value.toLowerCase()] ?? value;
    return 1;
  }
}

/** Join legacy deep-research report chunks stored at `src[6]`. */
function extractLegacyReportChunks(src: unknown[]): string {
  if (src.length <= 6 || !Array.isArray(src[6])) return '';
  const chunks = src[6].filter((c): c is string => typeof c === 'string' && c.length > 0);
  return chunks.join('\n\n');
}

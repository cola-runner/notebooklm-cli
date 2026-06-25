/**
 * Regression guards for the research wire protocol.
 *
 * Verified live (start → wait → import on a throwaway notebook). These pin the
 * START/POLL/IMPORT params and the poll task/source parsing.
 */

import { describe, expect, it } from 'vitest';
import { ResearchAPI } from '../../src/api/research.js';
import type { Session } from '../../src/session/session.js';

function makeResearch(responses: Record<string, unknown>): {
  api: ResearchAPI;
  calls: Array<{ method: string; params: unknown[] }>;
} {
  const calls: Array<{ method: string; params: unknown[] }> = [];
  const session = {
    call: async (method: string, params: unknown[]) => {
      calls.push({ method, params });
      return responses[method] ?? null;
    },
  } as unknown as Session;
  return { api: new ResearchAPI(session), calls };
}

describe('ResearchAPI.start', () => {
  it('sends START_FAST_RESEARCH params and parses task + report id', async () => {
    const { api, calls } = makeResearch({ START_FAST_RESEARCH: ['task-9', 'report-9'] });
    const started = await api.start('nb', 'quantum computing');
    expect(calls[0]).toEqual({
      method: 'START_FAST_RESEARCH',
      params: [['quantum computing', 1], null, 1, 'nb'],
    });
    expect(started).toEqual({
      taskId: 'task-9',
      reportId: 'report-9',
      notebookId: 'nb',
      query: 'quantum computing',
      mode: 'fast',
    });
  });

  it('rejects deep research over drive sources', async () => {
    const { api } = makeResearch({});
    await expect(api.start('nb', 'q', { mode: 'deep', source: 'drive' })).rejects.toThrow(
      /Deep Research/,
    );
  });
});

describe('ResearchAPI.poll', () => {
  it('parses a completed task with web sources + summary', async () => {
    const src = ['http://x.com', 'Example', 'desc', 1];
    const taskInfo = [null, ['my query'], null, [[src], 'the summary'], 2];
    const { api } = makeResearch({ POLL_RESEARCH: [['task-1', taskInfo]] });
    const result = await api.poll('nb');
    expect(result.status).toBe('completed');
    expect(result.query).toBe('my query');
    expect(result.summary).toBe('the summary');
    expect(result.sources).toEqual([
      { url: 'http://x.com', title: 'Example', resultType: 1, researchTaskId: 'task-1' },
    ]);
  });

  it('returns no_research for an empty poll', async () => {
    const { api } = makeResearch({ POLL_RESEARCH: null });
    expect(await api.poll('nb')).toEqual({ status: 'no_research', sources: [], tasks: [] });
  });
});

describe('ResearchAPI.importSources', () => {
  it('sends IMPORT_RESEARCH with web entries and parses imported ids', async () => {
    const { api, calls } = makeResearch({ IMPORT_RESEARCH: [[[['id1'], 'Title1']]] });
    const imported = await api.importSources('nb', 'task-1', [
      { url: 'http://x.com', title: 'X', resultType: 1, researchTaskId: 'task-1' },
    ]);
    expect(calls[0]).toEqual({
      method: 'IMPORT_RESEARCH',
      params: [
        null,
        [1],
        'task-1',
        'nb',
        [[null, null, ['http://x.com', 'X'], null, null, null, null, null, null, null, 2]],
      ],
    });
    expect(imported).toEqual([{ id: 'id1', title: 'Title1' }]);
  });

  it('rejects a source whose research_task_id does not match the task', async () => {
    const { api } = makeResearch({});
    await expect(
      api.importSources('nb', 'task-1', [
        { url: 'http://x.com', title: 'X', resultType: 1, researchTaskId: 'other' },
      ]),
    ).rejects.toThrow(/does not match/);
  });
});

describe('ResearchAPI.cancel', () => {
  it('sends CANCEL_RESEARCH keyed on the run id, scoped to the notebook path', async () => {
    // Local mock — captures the call options (sourcePath) the shared helper drops.
    const calls: Array<{ method: string; params: unknown[]; opts?: unknown }> = [];
    const session = {
      call: async (method: string, params: unknown[], opts?: unknown) => {
        calls.push({ method, params, opts });
        return [];
      },
    } as unknown as Session;
    const api = new ResearchAPI(session);

    await expect(api.cancel('nb-1', 'run-7')).resolves.toBeUndefined();
    expect(calls[0]).toEqual({
      method: 'CANCEL_RESEARCH',
      params: [null, null, 'run-7'],
      opts: { allowNull: true, sourcePath: '/notebook/nb-1' },
    });
  });
});

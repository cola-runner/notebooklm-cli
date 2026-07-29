/**
 * Regression guards for artifact-generation wire params.
 *
 * These offsets were wrong in the first cut and only surfaced against the live
 * API: a config placed one slot too far made CREATE_ARTIFACT return no
 * artifact_id (slide-deck, data-table), and an all-null infographic config was
 * rejected outright. The numbers below are the positions notebooklm-py uses and
 * that were verified end-to-end against Gemini Notebook.
 */

import { describe, expect, it } from 'vitest';
import { ArtifactsAPI } from '../../src/api/artifacts.js';
import type { NotebooksAPI } from '../../src/api/notebooks.js';
import {
  ArtifactStatus,
  InfographicDetail,
  InfographicOrientation,
  VideoFormat,
  VideoStyle,
} from '../../src/rpc/types.js';
import type { Session } from '../../src/session/session.js';

/** Build an ArtifactsAPI whose session.call records the params it was given. */
function makeApi(): { api: ArtifactsAPI; lastParams: () => unknown[] } {
  let captured: unknown[] = [];
  const session = {
    // CREATE_ARTIFACT returns [[artifactId, …, statusCode]] on success.
    call: async (_method: string, params: unknown[]) => {
      captured = params;
      return [['art-id', null, null, null, 2]];
    },
  } as unknown as Session;
  const notebooks = {
    getSourceIds: async () => ['s1', 's2'],
  } as unknown as NotebooksAPI;
  return { api: new ArtifactsAPI(session, notebooks), lastParams: () => captured };
}

/** The generation payload is [[2], notebookId, inner]; return `inner`. */
function inner(params: unknown[]): unknown[] {
  return params[2] as unknown[];
}

describe('generation params — config offsets', () => {
  it('data-table places its config at inner index 18', async () => {
    const { api, lastParams } = makeApi();
    await api.generateDataTable('nb');
    const slots = inner(lastParams());
    expect(slots.length).toBe(19);
    expect(slots[17]).toBeNull(); // last padding slot
    expect(slots[18]).toEqual([null, [null, 'en']]);
  });

  it('slide-deck places its config at inner index 16', async () => {
    const { api, lastParams } = makeApi();
    await api.generateSlideDeck('nb');
    const slots = inner(lastParams());
    expect(slots.length).toBe(17);
    expect(slots[15]).toBeNull(); // last padding slot
    expect(slots[16]).toEqual([[null, 'en', null, null]]);
  });

  it('infographic defaults orientation + detail to non-null at inner index 14', async () => {
    const { api, lastParams } = makeApi();
    await api.generateInfographic('nb');
    const slots = inner(lastParams());
    const config = slots[14] as unknown[][];
    expect(config[0]?.[3]).toBe(InfographicOrientation.LANDSCAPE);
    expect(config[0]?.[4]).toBe(InfographicDetail.STANDARD);
  });

  it('infographic honours explicit orientation + detail', async () => {
    const { api, lastParams } = makeApi();
    await api.generateInfographic('nb', {
      orientation: InfographicOrientation.PORTRAIT,
      detailLevel: InfographicDetail.DETAILED,
    });
    const config = (inner(lastParams())[14] as unknown[][])[0];
    expect(config?.[3]).toBe(InfographicOrientation.PORTRAIT);
    expect(config?.[4]).toBe(InfographicDetail.DETAILED);
  });
});

/** The video config rides at inner[8][2]: [double, lang, instr, null, format, style, prompt?]. */
function videoConfig(params: unknown[]): unknown[] {
  const wrap = inner(params)[8] as unknown[];
  return wrap[2] as unknown[];
}

describe('generation params — video style codes', () => {
  it('defaults the style slot to AUTO_SELECT, not null', async () => {
    const { api, lastParams } = makeApi();
    await api.generateVideo('nb');
    const cfg = videoConfig(lastParams());
    expect(cfg[5]).toBe(VideoStyle.AUTO_SELECT);
    expect(cfg).toHaveLength(6); // no trailing style prompt
  });

  it('sends the live (out-of-order) code for a named style', async () => {
    const { api, lastParams } = makeApi();
    await api.generateVideo('nb', { videoStyle: VideoStyle.ANIME });
    // Guards the de58d62 remap: ANIME is 7, not the old sequential 6 (=WATERCOLOR).
    expect(videoConfig(lastParams())[5]).toBe(7);
    expect(VideoStyle.ANIME).toBe(7);
  });

  it('serializes CUSTOM as null and carries the prompt in the trailing slot', async () => {
    const { api, lastParams } = makeApi();
    await api.generateVideo('nb', { videoStyle: VideoStyle.CUSTOM, stylePrompt: 'noir comic' });
    const cfg = videoConfig(lastParams());
    expect(cfg[5]).toBeNull();
    expect(cfg[6]).toBe('noir comic');
  });

  it('sends short-form video as format code 4', async () => {
    const { api, lastParams } = makeApi();
    await api.generateVideo('nb', { videoFormat: VideoFormat.SHORT });
    expect(videoConfig(lastParams())[4]).toBe(4);
  });

  it('rejects explicit styles for short-form video', async () => {
    const { api } = makeApi();
    await expect(
      api.generateVideo('nb', {
        videoFormat: VideoFormat.SHORT,
        videoStyle: VideoStyle.ANIME,
      }),
    ).rejects.toThrow(/fixed visual style/);
    await expect(
      api.generateVideo('nb', {
        videoFormat: VideoFormat.SHORT,
        stylePrompt: 'watercolor',
      }),
    ).rejects.toThrow(/fixed visual style/);
  });
});

describe('artifact retry params', () => {
  it('sends RETRY_ARTIFACT with the full client-options envelope, scoped to the notebook', async () => {
    // Local mock — captures the call options (sourcePath) the shared helper drops.
    const calls: Array<{ method: string; params: unknown[]; opts?: unknown }> = [];
    const session = {
      call: async (method: string, params: unknown[], opts?: unknown) => {
        calls.push({ method, params, opts });
        return [['art-1', null, null, null, ArtifactStatus.PROCESSING]];
      },
    } as unknown as Session;
    const notebooks = { getSourceIds: async () => [] } as unknown as NotebooksAPI;
    const api = new ArtifactsAPI(session, notebooks);

    const status = await api.retryFailed('nb-1', 'art-1');
    // Golden request shape from notebooklm-py rpc_golden/RETRY_ARTIFACT.json.
    expect(calls[0]).toEqual({
      method: 'RETRY_ARTIFACT',
      params: [
        [
          2,
          null,
          null,
          [1, null, null, null, null, null, null, null, null, null, [1]],
          [[1, 4, 8, 2, 3, 6]],
        ],
        'art-1',
      ],
      opts: { allowNull: true, sourcePath: '/notebook/nb-1' },
    });
    expect(status.taskId).toBe('art-1');
  });

  it('throws when retry returns null (unavailable/refused)', async () => {
    const session = { call: async () => null } as unknown as Session;
    const notebooks = { getSourceIds: async () => [] } as unknown as NotebooksAPI;
    const api = new ArtifactsAPI(session, notebooks);
    await expect(api.retryFailed('nb', 'art')).rejects.toThrow(/Retry unavailable/);
  });
});

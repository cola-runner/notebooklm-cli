/**
 * Regression guards for artifact-generation wire params.
 *
 * These offsets were wrong in the first cut and only surfaced against the live
 * API: a config placed one slot too far made CREATE_ARTIFACT return no
 * artifact_id (slide-deck, data-table), and an all-null infographic config was
 * rejected outright. The numbers below are the positions notebooklm-py uses and
 * that were verified end-to-end against NotebookLM.
 */

import { describe, expect, it } from 'vitest';
import { ArtifactsAPI } from '../../src/api/artifacts.js';
import type { NotebooksAPI } from '../../src/api/notebooks.js';
import { InfographicDetail, InfographicOrientation } from '../../src/rpc/types.js';
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

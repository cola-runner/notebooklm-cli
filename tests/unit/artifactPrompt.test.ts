import { describe, expect, it } from 'vitest';
import { ArtifactsAPI } from '../../src/api/artifacts.js';
import type { NotebooksAPI } from '../../src/api/notebooks.js';
import { ArtifactNotFoundError } from '../../src/rpc/errors.js';
import { ArtifactStatus, ArtifactTypeCode } from '../../src/rpc/types.js';
import type { Session } from '../../src/session/session.js';

function artifactRow(id: string, prompt?: string): unknown[] {
  const row: unknown[] = new Array(7).fill(null);
  row[0] = id;
  row[1] = 'Audio Overview';
  row[2] = ArtifactTypeCode.AUDIO;
  row[4] = ArtifactStatus.COMPLETED;
  if (prompt !== undefined) row[6] = [null, [prompt]];
  return row;
}

function makeApi(rows: unknown[][]): ArtifactsAPI {
  const session = {
    call: async () => [rows],
  } as unknown as Session;
  const notebooks = {
    getSourceIds: async () => [],
  } as unknown as NotebooksAPI;
  return new ArtifactsAPI(session, notebooks);
}

describe('ArtifactsAPI.getPrompt', () => {
  it('returns a stored generation prompt', async () => {
    const api = makeApi([artifactRow('a1', 'Summarize the sources')]);
    await expect(api.getPrompt('nb', 'a1')).resolves.toBe('Summarize the sources');
  });

  it('returns null when a known artifact has no prompt', async () => {
    const api = makeApi([artifactRow('a1')]);
    await expect(api.getPrompt('nb', 'a1')).resolves.toBeNull();
  });

  it('raises the typed not-found error for an unknown artifact', async () => {
    const api = makeApi([artifactRow('a1')]);
    await expect(api.getPrompt('nb', 'missing')).rejects.toBeInstanceOf(ArtifactNotFoundError);
  });
});

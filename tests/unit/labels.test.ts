import { describe, expect, it } from 'vitest';
import {
  LabelsAPI,
  buildCreateLabelParams,
  buildDeleteLabelsParams,
  buildGenerateLabelsParams,
  buildListLabelsParams,
  buildUpdateLabelParams,
  labelsFromEnvelope,
  parseLabelRow,
} from '../../src/api/labels.js';
import type { Session } from '../../src/session/session.js';

const OPTS = [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]]];

describe('label param builders', () => {
  it('LIST_LABELS = [opts, notebookId]', () => {
    expect(buildListLabelsParams('NB')).toEqual([OPTS, 'NB']);
  });

  it('CREATE_LABEL (manual) carries the label in slot [5]', () => {
    expect(buildCreateLabelParams('NB', 'Tax', '📁')).toEqual([
      OPTS,
      'NB',
      null,
      null,
      null,
      [['Tax', '📁']],
    ]);
  });

  it('CREATE_LABEL (generate) selects scope in slot [4]: [0] safe vs [] destructive', () => {
    expect(buildGenerateLabelsParams('NB', 'unlabeled')).toEqual([OPTS, 'NB', null, null, [0]]);
    expect(buildGenerateLabelsParams('NB', 'all')).toEqual([OPTS, 'NB', null, null, []]);
  });

  it('UPDATE_LABEL rename carries [name, emoji] in the group', () => {
    expect(buildUpdateLabelParams('NB', 'L1', { name: 'New', emoji: '🏷️' })).toEqual([
      OPTS,
      'NB',
      'L1',
      [[['New', '🏷️']]],
    ]);
  });

  it('UPDATE_LABEL assign puts [[sid]] in the add slot (name slot null)', () => {
    expect(buildUpdateLabelParams('NB', 'L1', { addSourceId: 'S1' })).toEqual([
      OPTS,
      'NB',
      'L1',
      [[null, [['S1']]]],
    ]);
  });

  it('UPDATE_LABEL unassign keeps remove at slot [2] (add slot stays null)', () => {
    expect(buildUpdateLabelParams('NB', 'L1', { removeSourceId: 'S1' })).toEqual([
      OPTS,
      'NB',
      'L1',
      [[null, null, [['S1']]]],
    ]);
  });

  it('DELETE_LABEL is a batch id array', () => {
    expect(buildDeleteLabelsParams('NB', ['L1', 'L2'])).toEqual([OPTS, 'NB', ['L1', 'L2']]);
  });
});

describe('label response parsing', () => {
  it('parses a row [name, sources, id, emoji] into a Label', () => {
    expect(parseLabelRow(['Tax', [['s1'], ['s2']], 'L1', '📁'], 'NB')).toEqual({
      id: 'L1',
      name: 'Tax',
      notebookId: 'NB',
      emoji: '📁',
      sourceIds: ['s1', 's2'],
    });
  });

  it('tolerates null sources and missing emoji', () => {
    expect(parseLabelRow(['Empty', null, 'L2'])).toEqual({
      id: 'L2',
      name: 'Empty',
      sourceIds: [],
    });
  });

  it('LIST envelope reads index 0, CREATE envelope reads index 1', () => {
    const row = ['A', [['s1']], 'L1', null];
    expect(labelsFromEnvelope([[row]], 0)).toHaveLength(1);
    expect(labelsFromEnvelope([null, [row]], 1)).toHaveLength(1);
    expect(labelsFromEnvelope([[row]], 1)).toEqual([]); // wrong index → empty
    expect(labelsFromEnvelope(null, 0)).toEqual([]);
  });
});

/** Mock session that records calls (incl. opts) and replays scripted results. */
function makeLabels(results: unknown[]): {
  api: LabelsAPI;
  calls: Array<{ method: string; params: unknown[]; opts?: unknown }>;
} {
  const calls: Array<{ method: string; params: unknown[]; opts?: unknown }> = [];
  let i = 0;
  const session = {
    call: async (method: string, params: unknown[], opts?: unknown) => {
      calls.push({ method, params, opts });
      return results[i++] ?? null;
    },
  } as unknown as Session;
  return { api: new LabelsAPI(session), calls };
}

describe('LabelsAPI behaviour', () => {
  it('list scopes the call to the notebook path', async () => {
    const { api, calls } = makeLabels([[[['Tax', [['s1']], 'L1', '📁']]]]);
    const labels = await api.list('NB');
    expect(labels).toEqual([
      { id: 'L1', name: 'Tax', notebookId: 'NB', emoji: '📁', sourceIds: ['s1'] },
    ]);
    expect(calls[0]?.method).toBe('LIST_LABELS');
    expect(calls[0]?.opts).toEqual({ allowNull: true, sourcePath: '/notebook/NB' });
  });

  it('create returns the single new label found by id-diff', async () => {
    // list() before → existing L1; CREATE echo → L1 + new L2.
    const { api } = makeLabels([
      [[['Old', null, 'L1', null]]],
      [
        null,
        [
          ['Old', null, 'L1', null],
          ['New', null, 'L2', null],
        ],
      ],
    ]);
    const created = await api.create('NB', 'New');
    expect(created.id).toBe('L2');
    expect(created.name).toBe('New');
  });

  it('create throws when no new id appears', async () => {
    const { api } = makeLabels([
      [[['Old', null, 'L1', null]]],
      [null, [['Old', null, 'L1', null]]],
    ]);
    await expect(api.create('NB', 'New')).rejects.toThrow(/expected exactly 1 new label/);
  });

  it('addSources issues one UPDATE_LABEL per (deduped) id, then re-reads', async () => {
    const { api, calls } = makeLabels([
      null, // UPDATE for s1
      null, // UPDATE for s2
      [[['Tax', [['s1'], ['s2']], 'L1', null]]], // final list() re-read
    ]);
    const updated = await api.addSources('NB', 'L1', ['s1', 's2', 's1']);
    const updates = calls.filter((c) => c.method === 'UPDATE_LABEL');
    expect(updates).toHaveLength(2); // duplicate s1 deduped
    expect(updates[0]?.params).toEqual([OPTS, 'NB', 'L1', [[null, [['s1']]]]]);
    expect(updated.sourceIds).toEqual(['s1', 's2']);
  });
});

/**
 * Source-label API — topic groupings of the sources within a notebook.
 *
 * Ported from notebooklm-py `_labels.py` + `_label/params.py` +
 * `_row_adapters/labels.py`. Four RPCs back it: LIST_LABELS, CREATE_LABEL
 * (manual create + AI auto-grouping), UPDATE_LABEL (rename / set emoji / assign /
 * unassign a source), DELETE_LABEL (batch). Every call is notebook-scoped — the
 * notebook id rides BOTH in the params (slot 1) and the `source-path` header.
 */

import type { Session } from '../session/session.js';
import type { Label } from '../types.js';

/** Fresh request-options wrapper (slot 0 of every label RPC). */
function labelOpts(): unknown[] {
  return [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]]];
}

export type GenerateScope = 'unlabeled' | 'all';

// =====================================================================
// Pure param builders (mirror notebooklm-py `_label/params.py`)
// =====================================================================

export function buildListLabelsParams(notebookId: string): unknown[] {
  return [labelOpts(), notebookId];
}

/** Manual create: scope slot [4] is null; slot [5] carries the label to create. */
export function buildCreateLabelParams(notebookId: string, name: string, emoji = ''): unknown[] {
  return [labelOpts(), notebookId, null, null, null, [[name, emoji]]];
}

/**
 * AI auto-grouping: scope slot [4] selects the mode.
 * `unlabeled` → `[0]` (incremental — only currently-unlabeled sources, safe);
 * `all` → `[]` (wipe + regenerate every label with new ids, destructive).
 */
export function buildGenerateLabelsParams(notebookId: string, scope: GenerateScope): unknown[] {
  return [labelOpts(), notebookId, null, null, scope === 'all' ? [] : [0]];
}

/**
 * UPDATE_LABEL fieldmask. Slot [3] = `[[ nameEmoji, sourcesAdd, sourcesRemove ]]`
 * (a three-slot group). The wire honours only the FIRST id per group per call,
 * so this builder is singular — pass at most one add and one remove id.
 */
export function buildUpdateLabelParams(
  notebookId: string,
  labelId: string,
  opts: { name?: string; emoji?: string; addSourceId?: string; removeSourceId?: string } = {},
): unknown[] {
  const { name, emoji, addSourceId, removeSourceId } = opts;
  const group: unknown[] = [];
  if (name !== undefined || emoji !== undefined) {
    group.push(emoji === undefined ? [name ?? null] : [name ?? null, emoji]);
  } else {
    group.push(null);
  }
  if (addSourceId !== undefined) {
    group.push([[addSourceId]]);
  }
  if (removeSourceId !== undefined) {
    if (addSourceId === undefined) group.push(null); // keep sourcesRemove at slot [2]
    group.push([[removeSourceId]]);
  }
  return [labelOpts(), notebookId, labelId, [group]];
}

/** Batch delete by id array. */
export function buildDeleteLabelsParams(notebookId: string, labelIds: string[]): unknown[] {
  return [labelOpts(), notebookId, labelIds];
}

// =====================================================================
// Pure response parsing (mirror `_row_adapters/labels.py`)
// =====================================================================

/** Parse one label row `[name, sources, labelId, emoji]` (sources = `[[sid], …]`|null). */
export function parseLabelRow(data: unknown, notebookId?: string): Label | null {
  if (!Array.isArray(data)) return null;
  const name = typeof data[0] === 'string' ? data[0] : '';
  const id = typeof data[2] === 'string' ? data[2] : '';
  if (!id) return null;
  const sourceIds: string[] = [];
  if (Array.isArray(data[1])) {
    for (const s of data[1]) {
      if (Array.isArray(s) && s.length === 1 && typeof s[0] === 'string') sourceIds.push(s[0]);
    }
  }
  const label: Label = { id, name, sourceIds };
  if (notebookId !== undefined) label.notebookId = notebookId;
  if (typeof data[3] === 'string' && data[3]) label.emoji = data[3];
  return label;
}

/**
 * Map a label-set envelope to `Label[]`. LIST_LABELS echoes `[[label, …]]`
 * (index 0); CREATE_LABEL echoes `[null, [label, …]]` (index 1). An empty/absent
 * set yields `[]`.
 */
export function labelsFromEnvelope(result: unknown, index: number, notebookId?: string): Label[] {
  if (!Array.isArray(result) || result.length <= index) return [];
  const raw = result[index];
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => parseLabelRow(row, notebookId)).filter((l): l is Label => l !== null);
}

// =====================================================================

export class LabelsAPI {
  constructor(private readonly session: Session) {}

  /** List all labels in a notebook, with their source membership. */
  async list(notebookId: string): Promise<Label[]> {
    const result = await this.session.call<unknown>(
      'LIST_LABELS',
      buildListLabelsParams(notebookId),
      {
        allowNull: true,
        sourcePath: `/notebook/${notebookId}`,
      },
    );
    return labelsFromEnvelope(result, 0, notebookId);
  }

  /** Get a single label by id (undefined if absent). */
  async get(notebookId: string, labelId: string): Promise<Label | undefined> {
    return (await this.list(notebookId)).find((l) => l.id === labelId);
  }

  /**
   * Create an empty, manually-named label. Located by id-diff (names may
   * collide): snapshot ids, create, return the single new label. Throws if zero
   * or more than one new id appears.
   */
  async create(notebookId: string, name: string, emoji = ''): Promise<Label> {
    const beforeIds = new Set((await this.list(notebookId)).map((l) => l.id));
    const result = await this.session.call<unknown>(
      'CREATE_LABEL',
      buildCreateLabelParams(notebookId, name, emoji),
      { allowNull: true, sourcePath: `/notebook/${notebookId}` },
    );
    const after = labelsFromEnvelope(result, 1, notebookId);
    const created = after.filter((l) => !beforeIds.has(l.id));
    if (created.length !== 1) {
      throw new Error(
        `create(name="${name}") expected exactly 1 new label, found ${created.length} (a concurrent create can cause this — retry from a fresh list).`,
      );
    }
    return created[0]!;
  }

  /**
   * AI-group sources into topic labels (the UI's "Auto-label" / "Reorganize").
   * `scope='unlabeled'` (default, safe) labels only currently-unlabeled sources,
   * preserving existing labels; `scope='all'` WIPES + regenerates every label
   * with new ids (destructive). Returns the full post-op label set.
   */
  async generate(notebookId: string, opts: { scope?: GenerateScope } = {}): Promise<Label[]> {
    const scope = opts.scope ?? 'unlabeled';
    if (scope !== 'all' && scope !== 'unlabeled') {
      throw new Error(`generate scope must be 'all' or 'unlabeled', got '${scope}'`);
    }
    const result = await this.session.call<unknown>(
      'CREATE_LABEL',
      buildGenerateLabelsParams(notebookId, scope),
      { allowNull: true, sourcePath: `/notebook/${notebookId}` },
    );
    return labelsFromEnvelope(result, 1, notebookId);
  }

  /**
   * Set a label's name and/or emoji. A rename preserves the existing emoji (the
   * wire's length-1 form is ambiguous, so the current emoji is carried over
   * explicitly). Throws if the label is missing or if neither field is given.
   */
  async update(
    notebookId: string,
    labelId: string,
    opts: { name?: string; emoji?: string },
  ): Promise<Label> {
    if (opts.name === undefined && opts.emoji === undefined) {
      throw new Error('update requires name and/or emoji');
    }
    const current = await this.get(notebookId, labelId);
    if (!current) throw new Error(`Label not found: ${labelId}`);
    // Carry the current emoji over on a name-only change so a rename never
    // clobbers the emoji.
    const effectiveEmoji =
      opts.name !== undefined && opts.emoji === undefined ? (current.emoji ?? '') : opts.emoji;
    const params = buildUpdateLabelParams(notebookId, labelId, {
      ...(opts.name !== undefined ? { name: opts.name } : {}),
      ...(effectiveEmoji !== undefined ? { emoji: effectiveEmoji } : {}),
    });
    await this.session.call('UPDATE_LABEL', params, {
      allowNull: true,
      sourcePath: `/notebook/${notebookId}`,
    });
    return (await this.get(notebookId, labelId)) ?? current;
  }

  /** Rename a label (preserves its emoji). */
  async rename(notebookId: string, labelId: string, name: string): Promise<Label> {
    return this.update(notebookId, labelId, { name });
  }

  /** Set a label's emoji. */
  async setEmoji(notebookId: string, labelId: string, emoji: string): Promise<Label> {
    return this.update(notebookId, labelId, { emoji });
  }

  /**
   * Assign source(s) to a label (append; existing members preserved). One RPC
   * per id — the server honours only the first id per call. Not atomic across
   * ids. Throws on an empty list or a missing label.
   */
  async addSources(notebookId: string, labelId: string, sourceIds: string[]): Promise<Label> {
    return this.mutateSources(notebookId, labelId, sourceIds, 'add');
  }

  /**
   * Un-assign source(s) from a label (membership only — the sources stay in the
   * notebook and in any other label). One RPC per id. Removing a non-member is a
   * no-op. Throws on an empty list or a missing label.
   */
  async removeSources(notebookId: string, labelId: string, sourceIds: string[]): Promise<Label> {
    return this.mutateSources(notebookId, labelId, sourceIds, 'remove');
  }

  /**
   * Delete one or more labels (batch). Accepts a single id or a list. The
   * sources survive (they become unlabeled). An empty list is a no-op.
   */
  async delete(notebookId: string, labelIds: string | string[]): Promise<void> {
    const ids = typeof labelIds === 'string' ? [labelIds] : labelIds;
    if (ids.length === 0) return;
    await this.session.call('DELETE_LABEL', buildDeleteLabelsParams(notebookId, ids), {
      allowNull: true,
      sourcePath: `/notebook/${notebookId}`,
    });
  }

  // -------------------------------------------------------------------------

  private async mutateSources(
    notebookId: string,
    labelId: string,
    sourceIds: string[],
    op: 'add' | 'remove',
  ): Promise<Label> {
    if (sourceIds.length === 0) {
      throw new Error(`${op === 'add' ? 'addSources' : 'removeSources'} requires at least one id`);
    }
    // Dedupe, order-preserving: one call per id, so duplicates are redundant.
    const uniqueIds = [...new Set(sourceIds)];
    for (const sourceId of uniqueIds) {
      const params = buildUpdateLabelParams(notebookId, labelId, {
        ...(op === 'add' ? { addSourceId: sourceId } : { removeSourceId: sourceId }),
      });
      await this.session.call('UPDATE_LABEL', params, {
        allowNull: true,
        sourcePath: `/notebook/${notebookId}`,
      });
    }
    const label = await this.get(notebookId, labelId);
    if (!label) throw new Error(`Label not found: ${labelId}`);
    return label;
  }
}

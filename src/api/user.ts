/**
 * User account API — subscription tier and account limits.
 *
 * GET_USER_SETTINGS (ZwVcOc) returns the authoritative limits block used by
 * Gemini Notebook itself. The tier enum rides at limits[4], beside the notebook and
 * per-notebook source limits. GET_USER_TIER is a promotions endpoint and is not
 * reliable for distinguishing free from paid accounts.
 */

import type { Session } from '../session/session.js';
import type { UserAccount } from '../types.js';

const TIER_LABELS: Record<number, string> = {
  1: 'Free',
  2: 'Pro',
  3: 'Ultra',
  4: 'Plus',
  5: 'Expanded',
  6: 'Ultra',
};

const TIER_CONSTANTS: Record<number, string> = {
  1: 'GEMINI_NOTEBOOK_TIER_STANDARD',
  2: 'GEMINI_NOTEBOOK_TIER_PRO',
  3: 'GEMINI_NOTEBOOK_TIER_ULTRA',
  4: 'GEMINI_NOTEBOOK_TIER_PLUS',
  5: 'GEMINI_NOTEBOOK_TIER_EXPANDED',
  6: 'GEMINI_NOTEBOOK_TIER_ULTRA',
};

/** Conservative friendly label for an authoritative account-limits tier code. */
export function tierLabelForCode(tierCode: number | undefined): string {
  if (tierCode === undefined) return 'Unknown';
  return TIER_LABELS[tierCode] ?? `Unknown (${tierCode})`;
}

/** Symbolic tier derived from the authoritative numeric code. */
export function tierConstantForCode(tierCode: number | undefined): string | undefined {
  if (tierCode === undefined) return undefined;
  return TIER_CONSTANTS[tierCode];
}

export class UserAPI {
  constructor(private readonly session: Session) {}

  /** Resolve the authenticated user's authoritative tier and account limits. */
  async whoami(): Promise<UserAccount> {
    const settingsResult = await this.session.call<unknown>('GET_USER_SETTINGS', settingsParams(), {
      allowNull: true,
    });
    const settings = parseUserSettings(settingsResult);
    const account: UserAccount = { tierLabel: tierLabelForCode(settings.tierCode) };
    const tier = tierConstantForCode(settings.tierCode);
    if (tier !== undefined) account.tier = tier;
    if (settings.tierCode !== undefined) account.tierCode = settings.tierCode;
    if (settings.notebookLimit !== undefined) account.notebookLimit = settings.notebookLimit;
    if (settings.sourceLimit !== undefined) account.sourceLimit = settings.sourceLimit;
    if (settings.language !== undefined) account.language = settings.language;
    return account;
  }
}

/** Request params for GET_USER_SETTINGS (per notebooklm-py rpc-reference). */
function settingsParams(): unknown[] {
  return [null, [1, null, null, null, null, null, null, null, null, null, [1]]];
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * Parse account limits, authoritative tier, and language from GET_USER_SETTINGS.
 *
 * Shape: `result[0][1]` is the limits block. Indexes 1/2 are notebook/source
 * limits and index 4 is the account tier. Language is at `result[0][2][4][0]`.
 */
export function parseUserSettings(result: unknown): {
  notebookLimit?: number;
  sourceLimit?: number;
  tierCode?: number;
  language?: string;
} {
  const out: {
    notebookLimit?: number;
    sourceLimit?: number;
    tierCode?: number;
    language?: string;
  } = {};
  if (!Array.isArray(result) || result.length === 0) return out;
  const root = result[0];
  if (!Array.isArray(root)) return out;

  const limits = root[1];
  if (Array.isArray(limits)) {
    const notebookLimit = positiveInteger(limits[1]);
    const sourceLimit = positiveInteger(limits[2]);
    const tierCode = positiveInteger(limits[4]);
    if (notebookLimit !== undefined) out.notebookLimit = notebookLimit;
    if (sourceLimit !== undefined) out.sourceLimit = sourceLimit;
    if (tierCode !== undefined) out.tierCode = tierCode;
  }

  const settings = root[2];
  if (Array.isArray(settings)) {
    const langField = settings[4];
    if (Array.isArray(langField) && typeof langField[0] === 'string') {
      out.language = langField[0];
    }
  }

  return out;
}

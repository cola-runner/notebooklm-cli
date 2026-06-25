/**
 * User account API — subscription tier and account limits.
 *
 * Wires up GET_USER_TIER (ozz5Z) and GET_USER_SETTINGS (ZwVcOc), whose RPC
 * method IDs were already present in `rpc/types.ts` but previously unused. The
 * param shapes follow notebooklm-py's `docs/rpc-reference.md`. Both calls are
 * read-only and idempotent, and both go through the default `source-path=/`
 * the Session already sets.
 *
 * The tier is the answer to "which feature rollout is my account in?" — the
 * 2026-06 agentic update (Gemini 3.5, chat-driven source discovery, code
 * execution) rolled out to AI Ultra and Workspace business accounts first.
 */

import type { Session } from '../session/session.js';
import type { UserAccount } from '../types.js';

/** Map a raw NOTEBOOKLM_TIER_* constant to a friendly label. */
const TIER_LABELS: Record<string, string> = {
  NOTEBOOKLM_TIER_STANDARD: 'Free',
  NOTEBOOKLM_TIER_PLUS: 'AI Plus',
  NOTEBOOKLM_TIER_PRO: 'AI Pro',
  // Consumer AI Pro reports this variant in the wild (live-observed 2026-06-16);
  // same plan as NOTEBOOKLM_TIER_PRO. (notebooklm-py d9fcc0b)
  NOTEBOOKLM_TIER_PRO_CONSUMER_USER: 'AI Pro',
  NOTEBOOKLM_TIER_PRO_DASHER_END_USER: 'Workspace Pro',
  NOTEBOOKLM_TIER_ULTRA: 'AI Ultra',
};

export function tierLabelFor(tier: string | undefined): string {
  if (!tier) return 'Unknown';
  return TIER_LABELS[tier] ?? tier;
}

export class UserAPI {
  constructor(private readonly session: Session) {}

  /**
   * Resolve the authenticated user's subscription tier plus, best-effort,
   * their account limits. A failure fetching settings does not fail the call —
   * the tier is the headline and settings are supplementary.
   */
  async whoami(): Promise<UserAccount> {
    const tierResult = await this.session.call<unknown>('GET_USER_TIER', tierParams(), {
      allowNull: true,
    });
    const account = parseUserTier(tierResult);

    try {
      const settingsResult = await this.session.call<unknown>(
        'GET_USER_SETTINGS',
        settingsParams(),
        {
          allowNull: true,
        },
      );
      const settings = parseUserSettings(settingsResult);
      if (settings.notebookLimit !== undefined) account.notebookLimit = settings.notebookLimit;
      if (settings.sourceLimit !== undefined) account.sourceLimit = settings.sourceLimit;
      if (settings.language !== undefined) account.language = settings.language;
    } catch {
      // Settings are best-effort; the tier alone is a valid result.
    }

    return account;
  }
}

/** Request params for GET_USER_TIER (per notebooklm-py rpc-reference). */
function tierParams(): unknown[] {
  return [
    [
      [
        [
          [null, '1', 627],
          [null, null, null, null, null, null, null, null, null, [null, null, 2]],
          1,
        ],
      ],
    ],
  ];
}

/** Request params for GET_USER_SETTINGS (per notebooklm-py rpc-reference). */
function settingsParams(): unknown[] {
  return [null, [1, null, null, null, null, null, null, null, null, null, [1]]];
}

/**
 * Extract the tier from a GET_USER_TIER response by recursively scanning for
 * the NOTEBOOKLM_TIER_* constant. Position-agnostic (mirrors the UUID scan in
 * chat.ts) so a layout shift in the surrounding envelope does not break it.
 */
export function parseUserTier(result: unknown): UserAccount {
  const tier = findTierString(result);
  return tier ? { tier, tierLabel: tierLabelFor(tier) } : { tierLabel: 'Unknown' };
}

function findTierString(data: unknown, depth = 8): string | undefined {
  if (depth < 0 || data == null) return undefined;
  if (typeof data === 'string') return /^NOTEBOOKLM_TIER_/.test(data) ? data : undefined;
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findTierString(item, depth - 1);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Parse account limits + language from a GET_USER_SETTINGS response.
 *
 * Shape (per rpc-reference): `result[0][1]` = `[?, notebookLimit, sourceLimit, ?]`,
 * language at `result[0][2][4][0]`. Every slot is read defensively.
 */
export function parseUserSettings(result: unknown): {
  notebookLimit?: number;
  sourceLimit?: number;
  language?: string;
} {
  const out: { notebookLimit?: number; sourceLimit?: number; language?: string } = {};
  if (!Array.isArray(result) || result.length === 0) return out;
  const root = result[0];
  if (!Array.isArray(root)) return out;

  const limits = root[1];
  if (Array.isArray(limits)) {
    if (typeof limits[1] === 'number') out.notebookLimit = limits[1];
    if (typeof limits[2] === 'number') out.sourceLimit = limits[2];
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

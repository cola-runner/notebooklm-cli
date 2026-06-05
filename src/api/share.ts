/**
 * Share API — notebook visibility + public link.
 *
 * Ported from `notebooklm-py/src/notebooklm/_sharing.py`. Covers the common
 * agent path: read the current sharing status and toggle anyone-with-link
 * public sharing. Per-user ACLs (add/remove collaborators) are not yet ported.
 */

import { getBaseUrl } from '../env.js';
import { ShareAccess } from '../rpc/types.js';
import type { Session } from '../session/session.js';
import type { ShareStatus, SharedUser } from '../types.js';

export class ShareAPI {
  constructor(private readonly session: Session) {}

  /** Read the current sharing configuration for a notebook. */
  async getStatus(notebookId: string): Promise<ShareStatus> {
    const result = await this.session.call<unknown>('GET_SHARE_STATUS', [notebookId, [2]], {
      allowNull: true,
    });
    return parseShareStatus(result, notebookId);
  }

  /**
   * Enable or disable anyone-with-link public sharing. Returns the refreshed
   * status (with `shareUrl` populated when public).
   */
  async setPublic(notebookId: string, isPublic: boolean): Promise<ShareStatus> {
    const access = isPublic ? ShareAccess.ANYONE_WITH_LINK : ShareAccess.RESTRICTED;
    const params = [[[notebookId, null, [access], [access, '']]], 1, null, [2]];
    await this.session.call('SHARE_NOTEBOOK', params, { allowNull: true });
    return this.getStatus(notebookId);
  }
}

/** Parse a GET_SHARE_STATUS response: `[[[user_entries]], [is_public], 1000]`. */
function parseShareStatus(data: unknown, notebookId: string): ShareStatus {
  const arr = Array.isArray(data) ? data : [];

  const sharedUsers: SharedUser[] = [];
  if (Array.isArray(arr[0])) {
    for (const entry of arr[0]) {
      const user = parseSharedUser(entry);
      if (user) sharedUsers.push(user);
    }
  }

  let isPublic = false;
  if (Array.isArray(arr[1]) && arr[1].length > 0) isPublic = Boolean(arr[1][0]);

  const status: ShareStatus = {
    notebookId,
    isPublic,
    access: isPublic ? ShareAccess.ANYONE_WITH_LINK : ShareAccess.RESTRICTED,
    sharedUsers,
  };
  if (isPublic) status.shareUrl = `${getBaseUrl()}/notebook/${encodeURIComponent(notebookId)}`;
  return status;
}

/** Parse a user entry: `[email, permission, [], [name, avatar]]`. */
function parseSharedUser(entry: unknown): SharedUser | null {
  if (!Array.isArray(entry) || typeof entry[0] !== 'string') return null;
  const user: SharedUser = {
    email: entry[0],
    permission: typeof entry[1] === 'number' ? entry[1] : 3,
  };
  if (Array.isArray(entry[3])) {
    if (typeof entry[3][0] === 'string') user.displayName = entry[3][0];
    if (typeof entry[3][1] === 'string') user.avatarUrl = entry[3][1];
  }
  return user;
}

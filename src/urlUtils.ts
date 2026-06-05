/**
 * URL classification helpers — kept hostname-based to avoid substring
 * matching vulnerabilities (e.g. `evil.com/youtube.com` would falsely
 * match a naive substring check).
 *
 * Ported from `notebooklm-py/src/notebooklm/_url_utils.py`.
 */

export function isYoutubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
  } catch {
    return false;
  }
}

export function isGoogleAuthRedirect(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'accounts.google.com' || host.endsWith('.accounts.google.com');
  } catch {
    return false;
  }
}

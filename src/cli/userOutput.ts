import type { UserAccount } from '../types.js';

/** Human-readable lines for `gemini-notebook whoami`. */
export function userAccountLines(account: UserAccount): string[] {
  const tierDetails: string[] = [];
  if (account.tierCode !== undefined) tierDetails.push(`code=${account.tierCode}`);
  if (account.tier) tierDetails.push(account.tier);

  const lines = [
    `Tier: ${account.tierLabel}${tierDetails.length > 0 ? `  (${tierDetails.join(', ')})` : ''}`,
  ];
  if (account.notebookLimit !== undefined) {
    lines.push(`Notebooks:  up to ${account.notebookLimit}`);
  }
  if (account.sourceLimit !== undefined) {
    lines.push(`Sources/nb: up to ${account.sourceLimit}`);
  }
  if (account.language) lines.push(`Language:   ${account.language}`);

  if (account.tierCode === 3 || account.tierCode === 6) {
    lines.push(
      '',
      '✓ Ultra — eligible for the 2026-06 agentic update (Gemini 3.5,',
      '  chat-driven source discovery, in-notebook code execution).',
    );
  } else if (account.tierCode !== undefined) {
    lines.push(
      '',
      'ℹ The 2026-06 agentic update rolled out to Ultra and Workspace business',
      '  first; your tier may not have it yet.',
    );
  }
  return lines;
}

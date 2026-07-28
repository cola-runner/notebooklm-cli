import { describe, expect, it } from 'vitest';
import { userAccountLines } from '../../src/cli/userOutput.js';
import type { UserAccount } from '../../src/types.js';

describe('userAccountLines', () => {
  it('shows the authoritative tier code and account limits', () => {
    const account: UserAccount = {
      tier: 'NOTEBOOKLM_TIER_PRO',
      tierCode: 2,
      tierLabel: 'Pro',
      notebookLimit: 500,
      sourceLimit: 300,
      language: 'en',
    };

    const lines = userAccountLines(account);

    expect(lines[0]).toContain('Pro');
    expect(lines[0]).toContain('code=2');
    expect(lines).toContain('Notebooks:  up to 500');
    expect(lines).toContain('Sources/nb: up to 300');
    expect(lines).toContain('Language:   en');
    expect(lines.join('\n')).not.toContain('eligible for the 2026-06 agentic update');
  });

  it.each([3, 6])('recognizes Ultra tier code %s', (tierCode) => {
    const lines = userAccountLines({ tierCode, tierLabel: 'Ultra' });
    expect(lines.join('\n')).toContain('eligible for the 2026-06 agentic update');
  });
});

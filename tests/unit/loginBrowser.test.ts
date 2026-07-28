import { describe, expect, it, vi } from 'vitest';
import { isNotebookAppUrl, navigateToNotebookApp } from '../../src/cli/loginBrowser.js';

describe('isNotebookAppUrl', () => {
  it('accepts the legacy and rebranded personal hosts', () => {
    expect(
      isNotebookAppUrl('https://notebooklm.google.com/', 'https://notebooklm.google.com'),
    ).toBe(true);
    expect(isNotebookAppUrl('https://notebook.google.com/', 'https://notebooklm.google.com')).toBe(
      true,
    );
  });

  it('keeps a configured custom base host and rejects unrelated hosts', () => {
    expect(isNotebookAppUrl('https://notes.example.com/', 'https://notes.example.com')).toBe(true);
    expect(isNotebookAppUrl('https://accounts.google.com/', 'https://notebooklm.google.com')).toBe(
      false,
    );
    expect(isNotebookAppUrl('not a url', 'https://notebooklm.google.com')).toBe(false);
  });
});

describe('navigateToNotebookApp', () => {
  it('waits only for navigation commit', async () => {
    const goto = vi.fn(async () => null);

    await navigateToNotebookApp({ goto } as never, 'https://notebooklm.google.com');

    expect(goto).toHaveBeenCalledWith('https://notebooklm.google.com/', {
      waitUntil: 'commit',
    });
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const currentFiles = ['README.md', 'CLAUDE.md', '.gitignore'];
const retiredProjectIdentifiers = [
  '@cola_runner/notebooklm-cli',
  'notebooklm-cli',
  'NotebookLMClient',
  'NOTEBOOKLM_',
  '~/.config/notebooklm-cli',
  'notebooklm login',
  'notebooklm list',
];

describe('current branding', () => {
  for (const file of currentFiles) {
    it(`${file} has no retired project-owned identifiers`, () => {
      const text = readFileSync(file, 'utf8');
      for (const value of retiredProjectIdentifiers) {
        expect(text).not.toContain(value);
      }
    });
  }
});

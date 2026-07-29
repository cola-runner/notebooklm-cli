import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GeminiNotebookClient } from '../../src/client.js';
import * as publicApi from '../../src/index.js';

describe('Gemini Notebook public identity', () => {
  it('publishes only the renamed package and executable', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      name: string;
      version: string;
      bin: Record<string, string>;
    };

    expect(pkg.name).toBe('@cola_runner/gemini-notebook-cli');
    expect(pkg.version).toBe('0.2.0');
    expect(pkg.bin).toEqual({ 'gemini-notebook': './dist/cli/index.js' });
  });

  it('exports only the renamed SDK client', () => {
    expect(publicApi.GeminiNotebookClient).toBe(GeminiNotebookClient);
    expect('NotebookLMClient' in publicApi).toBe(false);
  });
});

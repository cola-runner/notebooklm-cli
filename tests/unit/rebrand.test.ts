import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DISABLE_KEEPALIVE_ENV_VAR,
  REFRESH_CMD_ENV_VAR,
  STORAGE_ENV_VAR,
  defaultStoragePath,
  getStoragePath,
} from '../../src/auth/paths.js';
import { GeminiNotebookClient } from '../../src/client.js';
import * as publicApi from '../../src/index.js';
import { RPC_OVERRIDES_ENV_VAR } from '../../src/rpc/overrides.js';

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

  it('uses only the Gemini Notebook runtime namespace', () => {
    expect(defaultStoragePath()).toMatch(
      /[.]config[/\\]gemini-notebook-cli[/\\]storage_state[.]json$/,
    );
    expect(STORAGE_ENV_VAR).toBe('GEMINI_NOTEBOOK_STORAGE');
    expect(REFRESH_CMD_ENV_VAR).toBe('GEMINI_NOTEBOOK_REFRESH_CMD');
    expect(DISABLE_KEEPALIVE_ENV_VAR).toBe('GEMINI_NOTEBOOK_DISABLE_KEEPALIVE_POKE');
    expect(RPC_OVERRIDES_ENV_VAR).toBe('GEMINI_NOTEBOOK_RPC_OVERRIDES');
  });

  it('does not read the retired storage environment variable', () => {
    const previous = process.env['NOTEBOOKLM_STORAGE'];
    process.env['NOTEBOOKLM_STORAGE'] = '/tmp/retired-storage.json';
    try {
      expect(getStoragePath()).toBe(defaultStoragePath());
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, 'NOTEBOOKLM_STORAGE');
      else process.env['NOTEBOOKLM_STORAGE'] = previous;
    }
  });
});

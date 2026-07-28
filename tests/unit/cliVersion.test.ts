import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CLI version', () => {
  it('matches the published package version', () => {
    const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      version: string;
    };
    const result = spawnSync(
      process.execPath,
      [resolve('node_modules/tsx/dist/cli.mjs'), resolve('src/cli/index.ts'), '--version'],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
  });
});

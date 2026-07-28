import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { parseVideoCliOptions, registerArtifactCommands } from '../../src/cli/artifactCommands.js';
import { VideoFormat, VideoStyle } from '../../src/rpc/types.js';

describe('artifact command registration', () => {
  it('exposes short-form video options in the CLI help', () => {
    const program = new Command();
    registerArtifactCommands(program);
    const generate = program.commands.find((command) => command.name() === 'generate');
    const video = generate?.commands.find((command) => command.name() === 'video');
    const help = video?.helpInformation() ?? '';

    expect(help).toContain('--format <fmt>');
    expect(help).toContain('short');
    expect(help).toContain('--style <style>');
    expect(help).toContain('--style-prompt <text>');
  });

  it('maps CLI video values to the wire enums', () => {
    expect(parseVideoCliOptions({ format: 'short', style: 'auto' })).toEqual({
      videoFormat: VideoFormat.SHORT,
      videoStyle: VideoStyle.AUTO_SELECT,
    });
    expect(parseVideoCliOptions({ style: 'custom', stylePrompt: 'paper collage' })).toEqual({
      videoStyle: VideoStyle.CUSTOM,
      stylePrompt: 'paper collage',
    });
  });

  it('rejects unknown CLI video values', () => {
    expect(() => parseVideoCliOptions({ format: 'feature-length' })).toThrow(
      /Unknown video format/,
    );
    expect(() => parseVideoCliOptions({ style: 'oil-paint' })).toThrow(/Unknown video style/);
  });

  it('exposes the artifact get-prompt command', () => {
    const program = new Command();
    registerArtifactCommands(program);
    const artifact = program.commands.find((command) => command.name() === 'artifact');
    const getPrompt = artifact?.commands.find((command) => command.name() === 'get-prompt');

    expect(getPrompt?.helpInformation()).toContain(
      'get-prompt [options] <notebookId> <artifactId>',
    );
  });

  it('emits a JSON error for an invalid video option before opening a client', () => {
    const tsxCli = resolve('node_modules/tsx/dist/cli.mjs');
    const cli = resolve('src/cli/index.ts');
    const result = spawnSync(
      process.execPath,
      [tsxCli, cli, 'generate', 'video', 'nb', '--format', 'feature-length', '--json'],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(7);
    expect(JSON.parse(result.stdout)).toEqual({
      error: {
        code: 'RPC',
        message: 'Unknown video format: feature-length',
      },
    });
    expect(result.stderr).not.toContain('RPC error');
  });
});

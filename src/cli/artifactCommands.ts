/**
 * CLI commands for artifacts: `generate …`, `artifact …`, and `download …`.
 */

import type { Command } from 'commander';
import type { GenerationStatus } from '../artifactParse.js';
import { AudioFormat, AudioLength, ReportFormat } from '../rpc/types.js';
import { handleError, openClient } from './helpers.js';

interface CommonGenOpts {
  storage?: string;
  wait?: boolean;
  timeout?: string;
  language?: string;
  instructions?: string;
  sourceIds?: string;
}

function parseSourceIds(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

/** Shared options object passed into `generate*` API methods. */
function baseOpts(opts: CommonGenOpts): {
  sourceIds?: string[];
  language?: string;
  instructions?: string;
} {
  const out: { sourceIds?: string[]; language?: string; instructions?: string } = {};
  const ids = parseSourceIds(opts.sourceIds);
  if (ids) out.sourceIds = ids;
  if (opts.language) out.language = opts.language;
  if (opts.instructions) out.instructions = opts.instructions;
  return out;
}

function printStatus(prefix: string, status: GenerationStatus): void {
  if (status.status === 'failed') {
    console.error(`${prefix} failed: ${status.error ?? 'unknown error'}`);
    return;
  }
  let line = `${prefix} ${status.taskId} (status=${status.status})`;
  if (status.url) line += `\n  url: ${status.url}`;
  console.log(line);
}

/** Run a generation call, optionally blocking until it completes. */
async function runGeneration(
  opts: CommonGenOpts,
  notebookId: string,
  generate: (client: Awaited<ReturnType<typeof openClient>>) => Promise<GenerationStatus>,
): Promise<void> {
  try {
    const client = await openClient(opts.storage);
    const status = await generate(client);
    if (!status.taskId) {
      printStatus('Generation', status);
      await client.save();
      process.exit(1);
    }
    printStatus('Started:', status);
    if (opts.wait) {
      const final = await client.artifacts.waitForCompletion(notebookId, status.taskId, {
        timeoutMs: Number(opts.timeout ?? '600') * 1000,
        onStatusChange: (s) => console.log(`  … ${s.status}`),
      });
      printStatus('Final:', final);
      await client.save();
      if (final.status !== 'completed') process.exit(1);
    } else {
      await client.save();
    }
  } catch (err) {
    handleError(err);
  }
}

export function registerArtifactCommands(program: Command): void {
  const generate = program.command('generate').description('Generate studio artifacts');

  const withCommon = (cmd: Command): Command =>
    cmd
      .option('--storage <path>', 'Override storage_state.json path')
      .option('--wait', 'Wait for generation to finish', false)
      .option('--timeout <seconds>', 'Max seconds to wait when --wait is set', '600')
      .option('--language <lang>', 'Language code (default: en)')
      .option('--instructions <text>', 'Extra instructions to steer generation')
      .option('--source-ids <ids>', 'Comma-separated source IDs (default: all sources)');

  // ---- generate audio ----
  withCommon(generate.command('audio <notebookId>').description('Generate an Audio Overview'))
    .option('--format <fmt>', 'deep-dive | brief | critique | debate')
    .option('--length <len>', 'short | default | long')
    .action(
      async (notebookId: string, opts: CommonGenOpts & { format?: string; length?: string }) => {
        const fmtMap: Record<string, AudioFormat> = {
          'deep-dive': AudioFormat.DEEP_DIVE,
          brief: AudioFormat.BRIEF,
          critique: AudioFormat.CRITIQUE,
          debate: AudioFormat.DEBATE,
        };
        const lenMap: Record<string, AudioLength> = {
          short: AudioLength.SHORT,
          default: AudioLength.DEFAULT,
          long: AudioLength.LONG,
        };
        await runGeneration(opts, notebookId, (client) =>
          client.artifacts.generateAudio(notebookId, {
            ...baseOpts(opts),
            ...(opts.format && fmtMap[opts.format] ? { audioFormat: fmtMap[opts.format] } : {}),
            ...(opts.length && lenMap[opts.length] ? { audioLength: lenMap[opts.length] } : {}),
          }),
        );
      },
    );

  // ---- generate video ----
  withCommon(
    generate.command('video <notebookId>').description('Generate a Video Overview'),
  ).action(async (notebookId: string, opts: CommonGenOpts) => {
    await runGeneration(opts, notebookId, (client) =>
      client.artifacts.generateVideo(notebookId, baseOpts(opts)),
    );
  });

  // ---- generate report ----
  withCommon(generate.command('report <notebookId>').description('Generate a report'))
    .option('--format <fmt>', 'briefing-doc | study-guide | blog-post | custom', 'briefing-doc')
    .option('--prompt <text>', 'Custom prompt (with --format custom)')
    .action(
      async (notebookId: string, opts: CommonGenOpts & { format?: string; prompt?: string }) => {
        const fmtMap: Record<string, ReportFormat> = {
          'briefing-doc': ReportFormat.BRIEFING_DOC,
          'study-guide': ReportFormat.STUDY_GUIDE,
          'blog-post': ReportFormat.BLOG_POST,
          custom: ReportFormat.CUSTOM,
        };
        await runGeneration(opts, notebookId, (client) =>
          client.artifacts.generateReport(notebookId, {
            ...baseOpts(opts),
            reportFormat: fmtMap[opts.format ?? 'briefing-doc'] ?? ReportFormat.BRIEFING_DOC,
            ...(opts.prompt ? { customPrompt: opts.prompt } : {}),
            ...(opts.instructions ? { extraInstructions: opts.instructions } : {}),
          }),
        );
      },
    );

  // ---- simple generators (common flags only) ----
  const simple: Array<[string, string, keyof SimpleGenerators]> = [
    ['study-guide', 'Generate a study guide', 'generateStudyGuide'],
    ['quiz', 'Generate a quiz', 'generateQuiz'],
    ['flashcards', 'Generate flashcards', 'generateFlashcards'],
    ['infographic', 'Generate an infographic', 'generateInfographic'],
    ['slide-deck', 'Generate a slide deck', 'generateSlideDeck'],
    ['data-table', 'Generate a data table', 'generateDataTable'],
  ];
  for (const [name, desc, method] of simple) {
    withCommon(generate.command(`${name} <notebookId>`).description(desc)).action(
      async (notebookId: string, opts: CommonGenOpts) => {
        await runGeneration(opts, notebookId, (client) =>
          client.artifacts[method](notebookId, baseOpts(opts)),
        );
      },
    );
  }

  // ---- artifact list / delete / rename ----
  const artifact = program.command('artifact').description('Manage existing artifacts');

  artifact
    .command('list <notebookId>')
    .description('List artifacts in a notebook')
    .option('--storage <path>', 'Override storage_state.json path')
    .option('--json', 'Output as JSON', false)
    .action(async (notebookId: string, opts: { storage?: string; json: boolean }) => {
      try {
        const client = await openClient(opts.storage);
        const artifacts = await client.artifacts.list(notebookId);
        await client.save();
        if (opts.json) {
          console.log(JSON.stringify(artifacts, null, 2));
        } else if (artifacts.length === 0) {
          console.log('(no artifacts)');
        } else {
          for (const a of artifacts) {
            const date = a.createdAt ? new Date(a.createdAt).toISOString().slice(0, 10) : '—';
            console.log(`${a.id}  ${a.kind}  status=${a.status}  ${date}  ${a.title}`);
          }
        }
      } catch (err) {
        handleError(err);
      }
    });

  artifact
    .command('delete <notebookId> <artifactId>')
    .description('Delete an artifact')
    .option('--storage <path>', 'Override storage_state.json path')
    .action(async (notebookId: string, artifactId: string, opts: { storage?: string }) => {
      try {
        const client = await openClient(opts.storage);
        await client.artifacts.delete(notebookId, artifactId);
        await client.save();
        console.log(`Deleted ${artifactId}`);
      } catch (err) {
        handleError(err);
      }
    });

  artifact
    .command('rename <notebookId> <artifactId> <title>')
    .description('Rename an artifact')
    .option('--storage <path>', 'Override storage_state.json path')
    .action(
      async (notebookId: string, artifactId: string, title: string, opts: { storage?: string }) => {
        try {
          const client = await openClient(opts.storage);
          await client.artifacts.rename(notebookId, artifactId, title);
          await client.save();
          console.log(`Renamed ${artifactId} → ${title}`);
        } catch (err) {
          handleError(err);
        }
      },
    );

  // ---- download ----
  const download = program.command('download').description('Download a completed artifact');

  const mediaDownloads: Array<[string, string, keyof MediaDownloads]> = [
    ['audio', 'Download an Audio Overview (.mp4)', 'downloadAudio'],
    ['video', 'Download a Video Overview (.mp4)', 'downloadVideo'],
    ['infographic', 'Download an Infographic (image)', 'downloadInfographic'],
    ['report', 'Download a report (.md)', 'downloadReport'],
    ['data-table', 'Download a data table (.csv)', 'downloadDataTable'],
  ];
  for (const [name, desc, method] of mediaDownloads) {
    download
      .command(`${name} <notebookId> <outputPath>`)
      .description(desc)
      .option('--id <artifactId>', 'Specific artifact id (default: latest completed)')
      .option('--storage <path>', 'Override storage_state.json path')
      .action(
        async (notebookId: string, outputPath: string, opts: { id?: string; storage?: string }) => {
          try {
            const client = await openClient(opts.storage);
            const path = await client.artifacts[method](notebookId, outputPath, opts.id);
            await client.save();
            console.log(`Saved: ${path}`);
          } catch (err) {
            handleError(err);
          }
        },
      );
  }

  download
    .command('slide-deck <notebookId> <outputPath>')
    .description('Download a slide deck (.pdf or .pptx)')
    .option('--id <artifactId>', 'Specific artifact id (default: latest completed)')
    .option('--format <fmt>', 'pdf | pptx', 'pdf')
    .option('--storage <path>', 'Override storage_state.json path')
    .action(
      async (
        notebookId: string,
        outputPath: string,
        opts: { id?: string; format?: string; storage?: string },
      ) => {
        try {
          const fmt = opts.format === 'pptx' ? 'pptx' : 'pdf';
          const client = await openClient(opts.storage);
          const path = await client.artifacts.downloadSlideDeck(
            notebookId,
            outputPath,
            opts.id,
            fmt,
          );
          await client.save();
          console.log(`Saved: ${path}`);
        } catch (err) {
          handleError(err);
        }
      },
    );

  for (const [name, isQuiz] of [
    ['quiz', true],
    ['flashcards', false],
  ] as const) {
    download
      .command(`${name} <notebookId> <outputPath>`)
      .description(`Download ${name} (json | markdown | html)`)
      .option('--id <artifactId>', 'Specific artifact id (default: latest completed)')
      .option('--format <fmt>', 'json | markdown | html', 'json')
      .option('--storage <path>', 'Override storage_state.json path')
      .action(
        async (
          notebookId: string,
          outputPath: string,
          opts: { id?: string; format?: string; storage?: string },
        ) => {
          try {
            const fmt = opts.format === 'markdown' || opts.format === 'html' ? opts.format : 'json';
            const client = await openClient(opts.storage);
            const path = isQuiz
              ? await client.artifacts.downloadQuiz(notebookId, outputPath, opts.id, fmt)
              : await client.artifacts.downloadFlashcards(notebookId, outputPath, opts.id, fmt);
            await client.save();
            console.log(`Saved: ${path}`);
          } catch (err) {
            handleError(err);
          }
        },
      );
  }
}

// Method-name maps constrained to the right ArtifactsAPI signatures.
type ArtifactsAPIType = Awaited<ReturnType<typeof openClient>>['artifacts'];
type SimpleGenerators = {
  [K in keyof ArtifactsAPIType as ArtifactsAPIType[K] extends (
    notebookId: string,
    opts?: infer _O,
  ) => Promise<GenerationStatus>
    ? K
    : never]: ArtifactsAPIType[K];
};
type MediaDownloads = {
  [K in keyof ArtifactsAPIType as ArtifactsAPIType[K] extends (
    notebookId: string,
    outputPath: string,
    artifactId?: string,
  ) => Promise<string>
    ? K
    : never]: ArtifactsAPIType[K];
};

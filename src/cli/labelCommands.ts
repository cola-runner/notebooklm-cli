/**
 * CLI commands for source labels: `label list/create/generate/rename/emoji/
 * assign/unassign/delete`.
 *
 * Every command supports `--json`; progress goes to stderr so a `--json` stdout
 * stays a single clean JSON document.
 */

import type { Command } from 'commander';
import type { Label } from '../types.js';
import { openClient } from './helpers.js';
import { EXIT, emit, fail } from './output.js';

/** Human renderer for a label row. */
function printLabel(l: Label): void {
  const icon = l.emoji ? `${l.emoji} ` : '';
  console.log(`${l.id}  ${icon}${l.name}  (${l.sourceIds.length} source(s))`);
}

export function registerLabelCommands(program: Command): void {
  const label = program.command('label').description('Manage source labels (topic groupings)');

  label
    .command('list <notebookId>')
    .description('List labels in a notebook')
    .option('--storage <path>', 'Override storage_state.json path')
    .option('--json', 'Output as JSON', false)
    .action(async (notebookId: string, opts: { storage?: string; json: boolean }) => {
      try {
        const client = await openClient(opts.storage);
        const labels = await client.labels.list(notebookId);
        await client.save();
        emit(opts, labels, (rows) => {
          if (rows.length === 0) {
            console.log('(no labels)');
            return;
          }
          for (const l of rows) printLabel(l);
        });
      } catch (err) {
        fail(opts, err);
      }
    });

  label
    .command('create <notebookId> <name>')
    .description('Create an empty label')
    .option('--emoji <emoji>', 'Optional emoji icon')
    .option('--storage <path>', 'Override storage_state.json path')
    .option('--json', 'Output as JSON', false)
    .action(
      async (
        notebookId: string,
        name: string,
        opts: { emoji?: string; storage?: string; json: boolean },
      ) => {
        try {
          const client = await openClient(opts.storage);
          const created = await client.labels.create(notebookId, name, opts.emoji ?? '');
          await client.save();
          emit(opts, created, (l) => {
            console.log('Created label:');
            printLabel(l);
          });
        } catch (err) {
          fail(opts, err);
        }
      },
    );

  label
    .command('generate <notebookId>')
    .description('AI auto-group sources into labels')
    .option(
      '--scope <scope>',
      "'unlabeled' (safe, default) or 'all' (wipe + regenerate)",
      'unlabeled',
    )
    .option('-y, --yes', 'Confirm the destructive --scope all (required for it)', false)
    .option('--storage <path>', 'Override storage_state.json path')
    .option('--json', 'Output as JSON', false)
    .action(
      async (
        notebookId: string,
        opts: { scope: string; yes: boolean; storage?: string; json: boolean },
      ) => {
        try {
          if (opts.scope !== 'all' && opts.scope !== 'unlabeled') {
            const message = "--scope must be 'unlabeled' or 'all'";
            if (opts.json) {
              process.stderr.write(`${JSON.stringify({ error: { code: 'USAGE', message } })}\n`);
            } else {
              console.error(message);
            }
            process.exit(EXIT.USAGE);
          }
          if (opts.scope === 'all' && !opts.yes) {
            const message =
              '--scope all wipes and regenerates every label with new ids. Re-run with --yes to confirm.';
            if (opts.json) {
              process.stderr.write(`${JSON.stringify({ error: { code: 'USAGE', message } })}\n`);
            } else {
              console.error(message);
            }
            process.exit(EXIT.USAGE);
          }
          const client = await openClient(opts.storage);
          const labels = await client.labels.generate(notebookId, {
            scope: opts.scope as 'unlabeled' | 'all',
          });
          await client.save();
          emit(opts, labels, (rows) => {
            console.log(`${rows.length} label(s) after auto-grouping:`);
            for (const l of rows) printLabel(l);
          });
        } catch (err) {
          fail(opts, err);
        }
      },
    );

  label
    .command('rename <notebookId> <labelId> <name>')
    .description('Rename a label (keeps its emoji)')
    .option('--storage <path>', 'Override storage_state.json path')
    .option('--json', 'Output as JSON', false)
    .action(
      async (
        notebookId: string,
        labelId: string,
        name: string,
        opts: { storage?: string; json: boolean },
      ) => {
        try {
          const client = await openClient(opts.storage);
          const updated = await client.labels.rename(notebookId, labelId, name);
          await client.save();
          emit(opts, updated, (l) => {
            console.log('Renamed label:');
            printLabel(l);
          });
        } catch (err) {
          fail(opts, err);
        }
      },
    );

  label
    .command('emoji <notebookId> <labelId> <emoji>')
    .description("Set a label's emoji")
    .option('--storage <path>', 'Override storage_state.json path')
    .option('--json', 'Output as JSON', false)
    .action(
      async (
        notebookId: string,
        labelId: string,
        emoji: string,
        opts: { storage?: string; json: boolean },
      ) => {
        try {
          const client = await openClient(opts.storage);
          const updated = await client.labels.setEmoji(notebookId, labelId, emoji);
          await client.save();
          emit(opts, updated, (l) => printLabel(l));
        } catch (err) {
          fail(opts, err);
        }
      },
    );

  label
    .command('assign <notebookId> <labelId> <sourceIds...>')
    .description('Assign one or more sources to a label')
    .option('--storage <path>', 'Override storage_state.json path')
    .option('--json', 'Output as JSON', false)
    .action(
      async (
        notebookId: string,
        labelId: string,
        sourceIds: string[],
        opts: { storage?: string; json: boolean },
      ) => {
        try {
          const client = await openClient(opts.storage);
          const updated = await client.labels.addSources(notebookId, labelId, sourceIds);
          await client.save();
          emit(opts, updated, (l) => {
            console.log(`Assigned ${sourceIds.length} source(s):`);
            printLabel(l);
          });
        } catch (err) {
          fail(opts, err);
        }
      },
    );

  label
    .command('unassign <notebookId> <labelId> <sourceIds...>')
    .description('Un-assign one or more sources from a label')
    .option('--storage <path>', 'Override storage_state.json path')
    .option('--json', 'Output as JSON', false)
    .action(
      async (
        notebookId: string,
        labelId: string,
        sourceIds: string[],
        opts: { storage?: string; json: boolean },
      ) => {
        try {
          const client = await openClient(opts.storage);
          const updated = await client.labels.removeSources(notebookId, labelId, sourceIds);
          await client.save();
          emit(opts, updated, (l) => {
            console.log(`Un-assigned ${sourceIds.length} source(s):`);
            printLabel(l);
          });
        } catch (err) {
          fail(opts, err);
        }
      },
    );

  label
    .command('delete <notebookId> <labelIds...>')
    .description('Delete one or more labels (sources survive, become unlabeled)')
    .option('--storage <path>', 'Override storage_state.json path')
    .option('--json', 'Output as JSON', false)
    .action(
      async (notebookId: string, labelIds: string[], opts: { storage?: string; json: boolean }) => {
        try {
          const client = await openClient(opts.storage);
          await client.labels.delete(notebookId, labelIds);
          await client.save();
          emit(opts, { deleted: labelIds }, () =>
            console.log(`Deleted ${labelIds.length} label(s): ${labelIds.join(', ')}`),
          );
        } catch (err) {
          fail(opts, err);
        }
      },
    );
}

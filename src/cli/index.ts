#!/usr/bin/env node
/**
 * notebooklm-node CLI entry point.
 *
 * Commands:
 *   login           Open Chromium and capture storage_state.json
 *   status          Show current auth state
 *   list            List notebooks
 */

import { Command } from 'commander';
import { importChromeCookies } from '../auth/chromeCookies.js';
import { getStoragePath } from '../auth/paths.js';
import { findMissingRequiredCookies, loadStorageState, saveStorageState } from '../auth/storage.js';
import { configureProxyFromEnv } from '../proxy.js';
import { registerArtifactCommands } from './artifactCommands.js';
import { handleError, openClient } from './helpers.js';
import { runLogin } from './login.js';

// Honor http(s)_proxy env vars (undici ignores them by default).
const activeProxy = configureProxyFromEnv();
if (activeProxy && process.env['NOTEBOOKLM_DEBUG'] === '1') {
  console.error(`[notebooklm-node] routing requests through proxy ${activeProxy}`);
}

const program = new Command();

program.name('notebooklm').description('Unofficial NotebookLM CLI for Node.js').version('0.0.1');

program
  .command('login')
  .description('Open Chromium and capture storage_state.json after Google sign-in')
  .option('--storage <path>', 'Override storage_state.json path')
  .option('--headless', 'Run Chromium headlessly (rarely useful)', false)
  .action(async (opts: { storage?: string; headless: boolean }) => {
    const loginOpts: Parameters<typeof runLogin>[0] = { headless: opts.headless };
    if (opts.storage) loginOpts.storagePath = opts.storage;
    await runLogin(loginOpts);
  });

program
  .command('import-chrome')
  .description('Import Google session cookies from your local Chrome profile (macOS)')
  .option('--profile <name>', 'Chrome profile directory name', 'Default')
  .option('--storage <path>', 'Override storage_state.json path')
  .action(async (opts: { profile: string; storage?: string }) => {
    try {
      const state = await importChromeCookies(opts.profile);
      const path = opts.storage ?? getStoragePath();
      await saveStorageState(path, state);
      console.log(`Imported ${state.cookies.length} google.com cookies → ${path}`);
      const missing = findMissingRequiredCookies(state);
      if (missing.length > 0) {
        console.error(`⚠ Missing required auth cookies (need one of: ${missing.join(', ')}).`);
        console.error('  Make sure you are signed into NotebookLM in that Chrome profile,');
        console.error('  or try a different --profile (e.g. "Profile 1").');
        process.exit(1);
      }
      console.log('✓ Required auth cookies present. Try: notebooklm list');
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('status')
  .description('Show current auth state')
  .option('--storage <path>', 'Override storage_state.json path')
  .action(async (opts: { storage?: string }) => {
    const path = opts.storage ?? getStoragePath();
    const state = await loadStorageState(path);
    if (!state) {
      console.log(`No storage state at ${path}. Run 'notebooklm login'.`);
      process.exit(1);
    }
    const missing = findMissingRequiredCookies(state);
    console.log(`Storage:  ${path}`);
    console.log(`Cookies:  ${state.cookies.length}`);
    if (missing.length > 0) {
      console.log(`⚠ Missing one of: ${missing.join(', ')}`);
    } else {
      console.log('✓ Required cookies present');
    }
  });

program
  .command('list')
  .description('List notebooks')
  .option('--storage <path>', 'Override storage_state.json path')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: { storage?: string; json: boolean }) => {
    try {
      const client = await openClient(opts.storage);
      const notebooks = await client.notebooks.list();
      await client.save();
      if (opts.json) {
        console.log(JSON.stringify(notebooks, null, 2));
      } else if (notebooks.length === 0) {
        console.log('(no notebooks)');
      } else {
        for (const nb of notebooks) {
          const date = nb.createdAt ? new Date(nb.createdAt).toISOString().slice(0, 10) : '—';
          console.log(`${nb.id}  ${date}  ${nb.sourcesCount} src  ${nb.title}`);
        }
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('create <title>')
  .description('Create a new notebook')
  .option('--storage <path>', 'Override storage_state.json path')
  .option('--json', 'Output the created notebook as JSON', false)
  .action(async (title: string, opts: { storage?: string; json: boolean }) => {
    try {
      const client = await openClient(opts.storage);
      const nb = await client.notebooks.create(title);
      await client.save();
      if (opts.json) {
        console.log(JSON.stringify(nb, null, 2));
      } else {
        console.log(`Created: ${nb.id}  ${nb.title}`);
      }
    } catch (err) {
      handleError(err);
    }
  });

const source = program.command('source').description('Source operations within a notebook');

source
  .command('list <notebookId>')
  .description('List sources in a notebook')
  .option('--storage <path>', 'Override storage_state.json path')
  .option('--json', 'Output as JSON', false)
  .action(async (notebookId: string, opts: { storage?: string; json: boolean }) => {
    try {
      const client = await openClient(opts.storage);
      const sources = await client.sources.list(notebookId);
      await client.save();
      if (opts.json) {
        console.log(JSON.stringify(sources, null, 2));
      } else if (sources.length === 0) {
        console.log('(no sources)');
      } else {
        for (const s of sources) {
          console.log(`${s.id}  status=${s.status}  ${s.title ?? s.url ?? '(no title)'}`);
        }
      }
    } catch (err) {
      handleError(err);
    }
  });

source
  .command('add <notebookId>')
  .description('Add a source to a notebook (URL, YouTube, or --text)')
  .option('--url <url>', 'Add a URL or YouTube source')
  .option('--text <content>', 'Add a text snippet')
  .option('--title <title>', 'Title for the text snippet', 'Untitled')
  .option('--wait', 'Wait for the source to finish processing', false)
  .option('--timeout <seconds>', 'Max seconds to wait when --wait is set', '180')
  .option('--storage <path>', 'Override storage_state.json path')
  .action(
    async (
      notebookId: string,
      opts: {
        url?: string;
        text?: string;
        title: string;
        wait: boolean;
        timeout: string;
        storage?: string;
      },
    ) => {
      try {
        if (!opts.url && !opts.text) {
          console.error('Provide exactly one of --url or --text');
          process.exit(2);
        }
        const client = await openClient(opts.storage);
        const src = opts.url
          ? await client.sources.addUrl(notebookId, opts.url)
          : await client.sources.addText(notebookId, opts.title, opts.text!);
        if (opts.wait) {
          await client.sources.waitUntilReady(notebookId, src.id, {
            timeoutMs: Number(opts.timeout) * 1000,
          });
          console.log(`Added (ready): ${src.id}`);
        } else {
          console.log(`Added (status=${src.status}): ${src.id}`);
        }
        await client.save();
      } catch (err) {
        handleError(err);
      }
    },
  );

source
  .command('delete <notebookId> <sourceId>')
  .description('Delete a source from a notebook')
  .option('--storage <path>', 'Override storage_state.json path')
  .action(async (notebookId: string, sourceId: string, opts: { storage?: string }) => {
    try {
      const client = await openClient(opts.storage);
      await client.sources.delete(notebookId, sourceId);
      await client.save();
      console.log(`Deleted ${sourceId}`);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('ask <notebookId> <question>')
  .description('Ask a question about the notebook')
  .option('--storage <path>', 'Override storage_state.json path')
  .option('--json', 'Output result as JSON', false)
  .action(
    async (notebookId: string, question: string, opts: { storage?: string; json: boolean }) => {
      try {
        const client = await openClient(opts.storage);
        const result = await client.chat.ask(notebookId, question);
        await client.save();
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(result.answer);
        }
      } catch (err) {
        handleError(err);
      }
    },
  );

registerArtifactCommands(program);

program.parseAsync(process.argv).catch((err) => {
  handleError(err);
});

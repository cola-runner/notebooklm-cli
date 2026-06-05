#!/usr/bin/env node
/**
 * notebooklm-node CLI entry point.
 *
 * Commands:
 *   login           Open a browser, sign in, auto-capture the session (no keychain)
 *   login --paste   Paste "Copy as cURL" / a Cookie header instead (no browser)
 *   import-chrome   macOS shortcut: decrypt cookies from a local Chrome profile
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
import { runBrowserLogin } from './loginBrowser.js';
import { runPasteLogin } from './loginPaste.js';
import { readAllStdin } from './loginShared.js';
import { EXIT, emit, fail } from './output.js';

// Honor http(s)_proxy env vars (undici ignores them by default).
const activeProxy = configureProxyFromEnv();
if (activeProxy && process.env['NOTEBOOKLM_DEBUG'] === '1') {
  console.error(`[notebooklm-node] routing requests through proxy ${activeProxy}`);
}

const program = new Command();

program.name('notebooklm').description('Unofficial NotebookLM CLI for Node.js').version('0.0.1');

program
  .command('login')
  .description('Sign in: opens your browser, you log in, the session is captured (no keychain)')
  .option('--storage <path>', 'Override storage_state.json path')
  .option('--paste', 'Skip the browser; paste a "Copy as cURL" / Cookie header instead', false)
  .option('--curl-file <path>', 'Paste mode: read the cURL/Cookie text from a file')
  .option('--cookies <text>', 'Paste mode: pass the cURL/Cookie text directly (e.g. "$(pbpaste)")')
  .option('--timeout <seconds>', 'Browser mode: max seconds to wait for sign-in', '300')
  .option('--no-verify', 'Skip the live verification call before saving')
  .action(
    async (opts: {
      storage?: string;
      paste: boolean;
      curlFile?: string;
      cookies?: string;
      timeout: string;
      verify: boolean;
    }) => {
      try {
        // Paste mode when requested explicitly (--paste/--cookies/--curl-file),
        // or when cookies are actually piped in (e.g. `pbpaste | notebooklm
        // login`). A non-TTY stdin alone is NOT enough — under nohup/CI it is
        // empty, and we'd rather open a browser than fail on no input. So peek
        // the pipe and only switch to paste when it carries data.
        let pipedCookies: string | undefined;
        const explicitPaste = opts.paste || Boolean(opts.cookies) || Boolean(opts.curlFile);
        if (!explicitPaste && !process.stdin.isTTY) {
          const piped = await readAllStdin();
          if (piped.trim()) pipedCookies = piped;
        }

        if (explicitPaste || pipedCookies) {
          const pasteOpts: Parameters<typeof runPasteLogin>[0] = { verify: opts.verify };
          if (opts.storage) pasteOpts.storagePath = opts.storage;
          if (opts.curlFile) pasteOpts.curlFile = opts.curlFile;
          if (opts.cookies) pasteOpts.cookies = opts.cookies;
          else if (pipedCookies) pasteOpts.cookies = pipedCookies;
          await runPasteLogin(pasteOpts);
          return;
        }

        const browserOpts: Parameters<typeof runBrowserLogin>[0] = {
          verify: opts.verify,
          timeoutMs: Number(opts.timeout) * 1000,
        };
        if (opts.storage) browserOpts.storagePath = opts.storage;
        await runBrowserLogin(browserOpts);
      } catch (err) {
        handleError(err);
      }
    },
  );

program
  .command('import-chrome')
  .description('macOS shortcut: decrypt cookies from a local Chrome profile (prompts keychain)')
  .option('--profile <name>', 'Chrome profile directory name', 'Default')
  .option('--storage <path>', 'Override storage_state.json path')
  .option('--json', 'Output result as JSON', false)
  .action(async (opts: { profile: string; storage?: string; json: boolean }) => {
    try {
      const state = await importChromeCookies(opts.profile);
      const path = opts.storage ?? getStoragePath();
      await saveStorageState(path, state);
      const missing = findMissingRequiredCookies(state);
      const result = {
        storage: path,
        authenticated: missing.length === 0,
        cookieCount: state.cookies.length,
        missing,
      };
      emit(opts, result, () => {
        console.log(`Imported ${state.cookies.length} google.com cookies → ${path}`);
        if (missing.length > 0) {
          console.error(`⚠ Missing required auth cookies (need one of: ${missing.join(', ')}).`);
          console.error('  Make sure you are signed into NotebookLM in that Chrome profile,');
          console.error('  or try a different --profile (e.g. "Profile 1").');
        } else {
          console.log('✓ Required auth cookies present. Try: notebooklm list');
        }
      });
      if (missing.length > 0) process.exit(EXIT.AUTH);
    } catch (err) {
      fail(opts, err);
    }
  });

program
  .command('status')
  .description('Show current auth state')
  .option('--storage <path>', 'Override storage_state.json path')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: { storage?: string; json: boolean }) => {
    const path = opts.storage ?? getStoragePath();
    const state = await loadStorageState(path);
    if (!state) {
      const result = {
        storage: path,
        authenticated: false,
        cookieCount: 0,
        missing: [] as string[],
      };
      emit(opts, result, () => console.log(`No storage state at ${path}. Run 'notebooklm login'.`));
      process.exit(EXIT.AUTH);
    }
    const missing = findMissingRequiredCookies(state);
    const result = {
      storage: path,
      authenticated: missing.length === 0,
      cookieCount: state.cookies.length,
      missing,
    };
    emit(opts, result, () => {
      console.log(`Storage:  ${path}`);
      console.log(`Cookies:  ${state.cookies.length}`);
      if (missing.length > 0) console.log(`⚠ Missing one of: ${missing.join(', ')}`);
      else console.log('✓ Required cookies present');
    });
    if (missing.length > 0) process.exit(EXIT.AUTH);
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
      emit(opts, notebooks, (nbs) => {
        if (nbs.length === 0) {
          console.log('(no notebooks)');
          return;
        }
        for (const nb of nbs) {
          const date = nb.createdAt ? new Date(nb.createdAt).toISOString().slice(0, 10) : '—';
          console.log(`${nb.id}  ${date}  ${nb.sourcesCount} src  ${nb.title}`);
        }
      });
    } catch (err) {
      fail(opts, err);
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
      emit(opts, nb, () => console.log(`Created: ${nb.id}  ${nb.title}`));
    } catch (err) {
      fail(opts, err);
    }
  });

program
  .command('rename <notebookId> <newTitle>')
  .description('Rename a notebook')
  .option('--storage <path>', 'Override storage_state.json path')
  .option('--json', 'Output the updated notebook as JSON', false)
  .action(
    async (notebookId: string, newTitle: string, opts: { storage?: string; json: boolean }) => {
      try {
        const client = await openClient(opts.storage);
        const nb = await client.notebooks.rename(notebookId, newTitle);
        await client.save();
        emit(opts, nb, () => console.log(`Renamed ${nb.id} → ${nb.title}`));
      } catch (err) {
        fail(opts, err);
      }
    },
  );

program
  .command('delete <notebookId>')
  .description('Delete a notebook (irreversible — removes its sources, artifacts and chat)')
  .option('--storage <path>', 'Override storage_state.json path')
  .option('--json', 'Output as JSON', false)
  .action(async (notebookId: string, opts: { storage?: string; json: boolean }) => {
    try {
      const client = await openClient(opts.storage);
      await client.notebooks.delete(notebookId);
      await client.save();
      emit(opts, { deleted: true, id: notebookId }, () => console.log(`Deleted ${notebookId}`));
    } catch (err) {
      fail(opts, err);
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
      emit(opts, sources, (list) => {
        if (list.length === 0) {
          console.log('(no sources)');
          return;
        }
        for (const s of list) {
          console.log(`${s.id}  status=${s.status}  ${s.title ?? s.url ?? '(no title)'}`);
        }
      });
    } catch (err) {
      fail(opts, err);
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
  .option('--json', 'Output the added source as JSON', false)
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
        json: boolean;
      },
    ) => {
      try {
        if (!opts.url && !opts.text) {
          if (opts.json) {
            process.stderr.write(
              `${JSON.stringify({ error: { code: 'USAGE', message: 'Provide exactly one of --url or --text' } })}\n`,
            );
          } else {
            console.error('Provide exactly one of --url or --text');
          }
          process.exit(EXIT.USAGE);
        }
        const client = await openClient(opts.storage);
        let src = opts.url
          ? await client.sources.addUrl(notebookId, opts.url)
          : await client.sources.addText(notebookId, opts.title, opts.text!);
        if (opts.wait) {
          src = await client.sources.waitUntilReady(notebookId, src.id, {
            timeoutMs: Number(opts.timeout) * 1000,
          });
        }
        await client.save();
        emit(opts, src, () => console.log(`Added (status=${src.status}): ${src.id}`));
      } catch (err) {
        fail(opts, err);
      }
    },
  );

source
  .command('delete <notebookId> <sourceId>')
  .description('Delete a source from a notebook')
  .option('--storage <path>', 'Override storage_state.json path')
  .option('--json', 'Output as JSON', false)
  .action(
    async (notebookId: string, sourceId: string, opts: { storage?: string; json: boolean }) => {
      try {
        const client = await openClient(opts.storage);
        await client.sources.delete(notebookId, sourceId);
        await client.save();
        emit(opts, { deleted: true, id: sourceId }, () => console.log(`Deleted ${sourceId}`));
      } catch (err) {
        fail(opts, err);
      }
    },
  );

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
        emit(opts, result, () => console.log(result.answer));
      } catch (err) {
        fail(opts, err);
      }
    },
  );

registerArtifactCommands(program);

program.parseAsync(process.argv).catch((err) => {
  handleError(err);
});

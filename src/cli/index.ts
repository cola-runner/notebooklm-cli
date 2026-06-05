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
import type { ResearchPollResult, ShareStatus } from '../types.js';
import { registerArtifactCommands } from './artifactCommands.js';
import { handleError, openClient } from './helpers.js';
import { runBrowserLogin } from './loginBrowser.js';
import { runPasteLogin } from './loginPaste.js';
import { readAllStdin } from './loginShared.js';
import { EXIT, emit, fail } from './output.js';

/** Human renderer for a sharing status. */
function printShareStatus(s: ShareStatus): void {
  console.log(s.isPublic ? 'Public (anyone with link)' : 'Private (restricted)');
  if (s.shareUrl) console.log(`URL: ${s.shareUrl}`);
  if (s.sharedUsers.length > 0) {
    console.log(`Collaborators (${s.sharedUsers.length}):`);
    for (const u of s.sharedUsers) console.log(`  ${u.email} (permission ${u.permission})`);
  }
}

/** Human renderer for a research poll result. */
function printResearch(r: ResearchPollResult): void {
  console.log(`status: ${r.status}${r.taskId ? `  (task ${r.taskId})` : ''}`);
  if (r.summary) console.log(`\n${r.summary}`);
  if (r.sources.length > 0) {
    console.log(`\nSources (${r.sources.length}):`);
    for (const s of r.sources) {
      console.log(`  ${s.title || '(untitled)'}${s.url ? `\n    ${s.url}` : ''}`);
    }
  }
  if (r.report) console.log(`\n--- report ---\n${r.report}`);
}

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
  .option('--conversation-id <id>', 'Continue a conversation (id from a prior ask)')
  .option('--json', 'Output result as JSON', false)
  .action(
    async (
      notebookId: string,
      question: string,
      opts: { storage?: string; json: boolean; conversationId?: string },
    ) => {
      try {
        const client = await openClient(opts.storage);
        const askOpts = opts.conversationId ? { conversationId: opts.conversationId } : {};
        const result = await client.chat.ask(notebookId, question, askOpts);
        await client.save();
        emit(opts, result, () => {
          console.log(result.answer);
          if (result.references.length > 0) {
            console.log(`\nSources (${result.references.length}):`);
            for (const ref of result.references) {
              const n = ref.citationNumber ?? '?';
              const snippet = ref.citedText ? ` — ${ref.citedText.slice(0, 100)}` : '';
              console.log(`  [${n}] ${ref.sourceId}${snippet}`);
            }
          }
          if (result.conversationId) {
            console.log(`\nconversation: ${result.conversationId}`);
          }
        });
      } catch (err) {
        fail(opts, err);
      }
    },
  );

const note = program.command('note').description('Note operations within a notebook');

note
  .command('list <notebookId>')
  .description('List text notes in a notebook')
  .option('--storage <path>', 'Override storage_state.json path')
  .option('--json', 'Output as JSON', false)
  .action(async (notebookId: string, opts: { storage?: string; json: boolean }) => {
    try {
      const client = await openClient(opts.storage);
      const notes = await client.notes.list(notebookId);
      await client.save();
      emit(opts, notes, (list) => {
        if (list.length === 0) {
          console.log('(no notes)');
          return;
        }
        for (const n of list) {
          console.log(`${n.id}  ${n.title || '(untitled)'}`);
        }
      });
    } catch (err) {
      fail(opts, err);
    }
  });

note
  .command('get <notebookId> <noteId>')
  .description('Show a note (title + content)')
  .option('--storage <path>', 'Override storage_state.json path')
  .option('--json', 'Output as JSON', false)
  .action(async (notebookId: string, noteId: string, opts: { storage?: string; json: boolean }) => {
    try {
      const client = await openClient(opts.storage);
      const found = await client.notes.get(notebookId, noteId);
      await client.save();
      if (!found) {
        fail(opts, new Error(`Note not found: ${noteId}`));
        return;
      }
      emit(opts, found, (n) => {
        console.log(`# ${n.title || '(untitled)'}\n`);
        console.log(n.content);
      });
    } catch (err) {
      fail(opts, err);
    }
  });

note
  .command('create <notebookId>')
  .description('Create a note')
  .option('--storage <path>', 'Override storage_state.json path')
  .option('--title <title>', 'Note title', 'New Note')
  .option('--content <text>', 'Note content', '')
  .option('--json', 'Output the created note as JSON', false)
  .action(
    async (
      notebookId: string,
      opts: { storage?: string; json: boolean; title: string; content: string },
    ) => {
      try {
        const client = await openClient(opts.storage);
        const created = await client.notes.create(notebookId, opts.title, opts.content);
        await client.save();
        emit(opts, created, (n) => console.log(`Created note ${n.id}  ${n.title}`));
      } catch (err) {
        fail(opts, err);
      }
    },
  );

note
  .command('update <notebookId> <noteId>')
  .description('Update a note title and/or content')
  .option('--storage <path>', 'Override storage_state.json path')
  .option('--title <title>', 'New title')
  .option('--content <text>', 'New content')
  .option('--json', 'Output as JSON', false)
  .action(
    async (
      notebookId: string,
      noteId: string,
      opts: { storage?: string; json: boolean; title?: string; content?: string },
    ) => {
      try {
        const client = await openClient(opts.storage);
        // UPDATE_NOTE rewrites both fields, so fill any omitted one from the
        // current note rather than blanking it.
        const current = await client.notes.get(notebookId, noteId);
        const title = opts.title ?? current?.title ?? '';
        const content = opts.content ?? current?.content ?? '';
        await client.notes.update(notebookId, noteId, content, title);
        await client.save();
        emit(opts, { id: noteId, title, content }, () => console.log(`Updated note ${noteId}`));
      } catch (err) {
        fail(opts, err);
      }
    },
  );

note
  .command('delete <notebookId> <noteId>')
  .description('Delete a note')
  .option('--storage <path>', 'Override storage_state.json path')
  .option('--json', 'Output as JSON', false)
  .action(async (notebookId: string, noteId: string, opts: { storage?: string; json: boolean }) => {
    try {
      const client = await openClient(opts.storage);
      await client.notes.delete(notebookId, noteId);
      await client.save();
      emit(opts, { deleted: true, id: noteId }, () => console.log(`Deleted ${noteId}`));
    } catch (err) {
      fail(opts, err);
    }
  });

const share = program.command('share').description('Notebook sharing (public link)');

share
  .command('status <notebookId>')
  .description('Show sharing status (public? share url, collaborators)')
  .option('--storage <path>', 'Override storage_state.json path')
  .option('--json', 'Output as JSON', false)
  .action(async (notebookId: string, opts: { storage?: string; json: boolean }) => {
    try {
      const client = await openClient(opts.storage);
      const status = await client.share.getStatus(notebookId);
      await client.save();
      emit(opts, status, (s) => printShareStatus(s));
    } catch (err) {
      fail(opts, err);
    }
  });

share
  .command('public <notebookId>')
  .description('Enable anyone-with-link sharing; prints the share URL')
  .option('--storage <path>', 'Override storage_state.json path')
  .option('--json', 'Output as JSON', false)
  .action(async (notebookId: string, opts: { storage?: string; json: boolean }) => {
    try {
      const client = await openClient(opts.storage);
      const status = await client.share.setPublic(notebookId, true);
      await client.save();
      emit(opts, status, (s) => printShareStatus(s));
    } catch (err) {
      fail(opts, err);
    }
  });

share
  .command('private <notebookId>')
  .description('Disable public sharing (restrict to invited users)')
  .option('--storage <path>', 'Override storage_state.json path')
  .option('--json', 'Output as JSON', false)
  .action(async (notebookId: string, opts: { storage?: string; json: boolean }) => {
    try {
      const client = await openClient(opts.storage);
      const status = await client.share.setPublic(notebookId, false);
      await client.save();
      emit(opts, status, (s) => printShareStatus(s));
    } catch (err) {
      fail(opts, err);
    }
  });

const research = program.command('research').description('Web/Drive research discovery');

research
  .command('start <notebookId> <query>')
  .description('Start a research session (optionally wait for results)')
  .option('--storage <path>', 'Override storage_state.json path')
  .option('--mode <mode>', 'fast | deep (deep is web-only)', 'fast')
  .option('--source <source>', 'web | drive', 'web')
  .option('--wait', 'Wait for results before returning', false)
  .option('--timeout <seconds>', 'Max seconds to wait when --wait is set', '300')
  .option('--json', 'Output as JSON', false)
  .action(
    async (
      notebookId: string,
      query: string,
      opts: {
        storage?: string;
        json: boolean;
        mode: string;
        source: string;
        wait?: boolean;
        timeout: string;
      },
    ) => {
      try {
        const client = await openClient(opts.storage);
        const started = await client.research.start(notebookId, query, {
          mode: opts.mode as 'fast' | 'deep',
          source: opts.source as 'web' | 'drive',
        });
        if (!started) {
          fail(opts, new Error('Research could not be started (no task id returned).'));
          return;
        }
        if (!opts.wait) {
          await client.save();
          emit(opts, started, (s) =>
            console.log(
              `Started ${s.mode} research: task ${s.taskId}\n  poll with: research poll ${notebookId} --task-id ${s.taskId}`,
            ),
          );
          return;
        }
        const result = await client.research.waitForResults(notebookId, started.taskId, {
          timeoutMs: Number(opts.timeout) * 1000,
          onStatus: (s) => console.error(`  … ${s}`),
        });
        await client.save();
        emit(opts, result, (r) => printResearch(r));
        if (result.status === 'in_progress') process.exit(EXIT.NOT_READY);
      } catch (err) {
        fail(opts, err);
      }
    },
  );

research
  .command('poll <notebookId>')
  .description('Poll for research results')
  .option('--storage <path>', 'Override storage_state.json path')
  .option('--task-id <id>', 'Select a specific in-flight task')
  .option('--json', 'Output as JSON', false)
  .action(
    async (notebookId: string, opts: { storage?: string; json: boolean; taskId?: string }) => {
      try {
        const client = await openClient(opts.storage);
        const result = await client.research.poll(notebookId, opts.taskId);
        await client.save();
        emit(opts, result, (r) => printResearch(r));
      } catch (err) {
        fail(opts, err);
      }
    },
  );

research
  .command('import <notebookId> <taskId>')
  .description('Import discovered sources for a task into the notebook')
  .option('--storage <path>', 'Override storage_state.json path')
  .option('--limit <n>', 'Import at most N sources', '5')
  .option('--json', 'Output as JSON', false)
  .action(
    async (
      notebookId: string,
      taskId: string,
      opts: { storage?: string; json: boolean; limit: string },
    ) => {
      try {
        const client = await openClient(opts.storage);
        const polled = await client.research.poll(notebookId, taskId);
        const limit = Math.max(0, Number(opts.limit) || 0);
        const picked = polled.sources.slice(0, limit);
        if (picked.length === 0) {
          fail(opts, new Error('No importable sources for that task (poll returned none).'));
          return;
        }
        const imported = await client.research.importSources(notebookId, taskId, picked);
        await client.save();
        emit(opts, { imported }, () => {
          console.log(`Imported ${imported.length} source(s):`);
          for (const s of imported) console.log(`  ${s.id}  ${s.title}`);
        });
      } catch (err) {
        fail(opts, err);
      }
    },
  );

registerArtifactCommands(program);

program.parseAsync(process.argv).catch((err) => {
  handleError(err);
});

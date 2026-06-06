<div align="center">

# 📓 notebooklm-cli

### The **agent-first** NotebookLM client for Node.js & TypeScript

Drive Google NotebookLM from your terminal or your code — with a **JSON-first CLI
purpose-built for LLM agents**: structured output, machine-readable errors, and
exit codes you can branch on.

[![Built for agents](https://img.shields.io/badge/built%20for-LLM%20agents-8A2BE2.svg)](#-built-for-ai-agents)
[![npm](https://img.shields.io/npm/v/@cola_runner/notebooklm-cli?color=CB3837&logo=npm)](https://www.npmjs.com/package/@cola_runner/notebooklm-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-3C873A.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg)](tsconfig.json)
[![Tests](https://img.shields.io/badge/tests-99%20passing-2EA44F.svg)](tests)

</div>

> ⚠️ **Unofficial.** This talks to Google NotebookLM's internal RPC endpoints,
> which can change without notice. Not affiliated with or endorsed by Google.
> Inspired by [notebooklm-py](https://github.com/teng-lin/notebooklm-py).

---

## 🤖 Built for AI agents

Most CLIs are written for a human to *read*. This one is written for an **agent to
*drive***. Three design rules make it safe to hand to an LLM:

1. **`--json` on every data command** — parse results, never scrape prose.
2. **Errors are data** — a failure prints `{ "error": { "code", "message" } }` to
   **stdout** (so a single capture always parses), with details when useful.
3. **Exit codes are a contract** — branch on *what* failed, no string matching:

| Exit | Code | Meaning | Agent action |
|:---:|---|---|---|
| `0` | `OK` | success | use the JSON result |
| `3` | `AUTH` | session expired/rejected | run `notebooklm login` |
| `4` | `NOT_FOUND` | resource missing | stop / report |
| `5` | `NOT_READY` | artifact still generating | poll again later |
| `6` | `RATE_LIMIT` | throttled | back off and retry |
| `7` | `RPC` | protocol/API drift | surface details |
| `8` | `NETWORK` | transport/timeout | retry |

```bash
# An agent driving the CLI — branch on the exit code, parse stdout as JSON.
out=$(notebooklm ask "$NB" "Summarize the latest source" --json); code=$?
case $code in
  0) echo "$out" | jq -r '.answer, (.references[] | "  ["+(.citationNumber|tostring)+"] "+.sourceId)' ;;
  3) notebooklm login ;;     # AUTH  → refresh session, retry
  6) sleep 30 ;;             # RATE_LIMIT → back off
  *) echo "$out" | jq -r '.error.message' >&2 ;;
esac
```

Progress goes to **stderr**, results to **stdout** — pipe one without the other.

---

## ✨ Highlights

- 🔑 **Keychain-free login** — sign in through your real browser (cookies are read
  *after* you log in; nothing is decrypted off disk) or paste a "Copy as cURL".
  No OS-keychain prompt, so it works for anyone — not just the machine that made
  the session.
- 📚 **Grounded chat** — answers carry real **citations** (source id, cited
  passage, character ranges, relevance score) and support **multi-turn**
  conversations via `ask --conversation-id`.
- 🎨 **Every studio artifact** — audio, video (incl. cinematic), report
  (briefing / study guide / blog post / custom), quiz, flashcards, infographic,
  slide deck, data table — **generate *and* download**.
- 🔬 **Research · notes · sharing** — web/Drive research discovery + import,
  notes CRUD, and public-link sharing.
- 🧱 **Solid by construction** — TypeScript strict mode, `undici` transport with
  network-fault classification + retry, **99 unit tests**, and *every* feature
  verified end-to-end against the live API (not just mocks).

---

## 🚀 Install

```bash
npm install -g @cola_runner/notebooklm-cli     # global `notebooklm` command
# …or run without installing:
npx @cola_runner/notebooklm-cli login
```

The core install is tiny — just `commander` / `undici` / `tough-cookie`, no
browser. That's all an agent needs: authenticate headless with
`notebooklm login --paste` (paste a "Copy as cURL"/Cookie header), then every
other command is pure HTTP.

The one-click **browser** login is optional and needs Playwright:

```bash
npm i -g playwright && playwright install chromium   # only for `notebooklm login`
```

<details>
<summary><b>From source (contributors)</b></summary>

```bash
git clone https://github.com/cola-runner/notebooklm-cli.git && cd notebooklm-cli
pnpm install
pnpm build
pnpm playwright install chromium     # one-time, for browser login
npm link                             # puts `notebooklm` on your PATH
```

> No build step while hacking? Use `pnpm dev <command>` to run straight from source.
</details>

```bash
notebooklm login           # browser sign-in (or `login --paste` for headless)
notebooklm list            # confirm it worked
```

---

## 🧰 Commands

```bash
# Auth
notebooklm login                      # browser auto-capture (no keychain)
notebooklm login --paste              # or paste a "Copy as cURL" / Cookie header
notebooklm status                     # check auth state

# Notebooks
notebooklm list
notebooklm create "My research"
notebooklm rename <nb> "New title"
notebooklm delete <nb>

# Sources
notebooklm source add <nb> --url https://en.wikipedia.org/wiki/SpaceX
notebooklm source add <nb> --text "..." --title "Notes"
notebooklm source list <nb>

# Chat (with citations + follow-ups)
notebooklm ask <nb> "What is this about?"
notebooklm ask <nb> "And what about that?" --conversation-id <id>

# Notes
notebooklm note create <nb> --title "T" --content "..."
notebooklm note list <nb>

# Sharing
notebooklm share public <nb>          # anyone-with-link; prints the share URL
notebooklm share status <nb>

# Research (web/Drive discovery → import)
notebooklm research start <nb> "history of the Falcon 9" --wait
notebooklm research import <nb> <taskId> --limit 5

# Studio artifacts — generate & download
notebooklm generate audio <nb> --format deep-dive --wait
notebooklm generate report <nb> --format study-guide --wait
notebooklm artifact list <nb>
notebooklm download audio <nb> ./overview.mp4
notebooklm download slide-deck <nb> ./deck.pdf
```

Add `--json` to any of the above for machine-readable output.

---

## 🧩 Programmatic API

```ts
import { NotebookLMClient } from '@cola_runner/notebooklm-cli';

const client = await NotebookLMClient.fromStorage();

const nb = await client.notebooks.create('Research');
await client.sources.addUrl(nb.id, 'https://en.wikipedia.org/wiki/SpaceX');

const { answer, references } = await client.chat.ask(nb.id, 'Summarize the source.');
console.log(answer);
for (const r of references) console.log(`[${r.citationNumber}] ${r.sourceId} — ${r.citedText}`);

// Generate an audio overview, then block until it's ready.
const { taskId } = await client.artifacts.generateAudio(nb.id);
await client.artifacts.waitForCompletion(nb.id, taskId);
```

---

## 📊 Status

| Area | Status |
|---|:---:|
| RPC encoder/decoder · auth + cookies · session/transport | ✅ |
| `notebooks` — list / create / get / rename / delete | ✅ |
| `sources` — add URL/YouTube/text · list · delete · wait | ✅ |
| `chat` — ask · **citations** · **multi-turn** | ✅ |
| `artifacts` — generate · list · poll · download · delete · rename · export | ✅ |
| `notes` (CRUD) · `share` (public link) · `research` (web/Drive) | ✅ |
| Mind maps · per-user share ACLs · save-answer-as-note | ⏳ planned |

---

## 🙏 Credits

Protocol groundwork and RPC method IDs come from
[notebooklm-py](https://github.com/teng-lin/notebooklm-py). This is an
independent TypeScript reimplementation with an agent-first CLI.

## 📄 License

[MIT](LICENSE)

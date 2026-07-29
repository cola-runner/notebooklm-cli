<div align="center">

# 📓 gemini-notebook-cli

### The **agent-first** Gemini Notebook client for Node.js & TypeScript

Drive Gemini Notebook from your terminal or your code — with a **JSON-first CLI
purpose-built for LLM agents**: structured output, machine-readable errors, and
exit codes you can branch on.

[![Built for agents](https://img.shields.io/badge/built%20for-LLM%20agents-8A2BE2.svg)](#-built-for-ai-agents)
[![npm](https://img.shields.io/npm/v/@cola_runner/gemini-notebook-cli?color=CB3837&logo=npm)](https://www.npmjs.com/package/@cola_runner/gemini-notebook-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-3C873A.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg)](tsconfig.json)
[![Tests](https://img.shields.io/badge/tests-183%20passing-2EA44F.svg)](tests)

</div>

> ⚠️ **Unofficial.** This talks to Gemini Notebook's internal RPC endpoints,
> which can change without notice. Not affiliated with or endorsed by Google.
> Inspired by [notebooklm-py](https://github.com/teng-lin/notebooklm-py).
> Gemini Notebook was formerly known as NotebookLM.

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
| `3` | `AUTH` | session expired/rejected | run `gemini-notebook login` |
| `4` | `NOT_FOUND` | resource missing | stop / report |
| `5` | `NOT_READY` | artifact still generating | poll again later |
| `6` | `RATE_LIMIT` | throttled | back off and retry |
| `7` | `RPC` | protocol/API drift | surface details |
| `8` | `NETWORK` | transport/timeout | retry |

```bash
# An agent driving the CLI — branch on the exit code, parse stdout as JSON.
out=$(gemini-notebook ask "$NB" "Summarize the latest source" --json); code=$?
case $code in
  0) echo "$out" | jq -r '.answer, (.references[] | "  ["+(.citationNumber|tostring)+"] "+.sourceId)' ;;
  3) gemini-notebook login ;;     # AUTH  → refresh session, retry
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
  the session. Browser login follows both the legacy Google host and the current
  Gemini Notebook host.
- 📚 **Grounded chat** — answers carry real **citations** (source id, cited
  passage, character ranges, relevance score) and support **multi-turn**
  conversations via `ask --conversation-id`.
- 🎨 **Every studio artifact** — audio, video (incl. cinematic and short-form), report
  (briefing / study guide / blog post / custom), quiz, flashcards, infographic,
  slide deck, data table — **generate *and* download**, inspect the stored
  generation prompt, and **retry** a failed one.
- 🏷️ **Organize & steer** — group a notebook's sources into **labels** (manual or
  AI auto-grouping), filter `source list` by label, and get **AI-suggested
  prompts** for what to ask next.
- 🔬 **Research · notes · sharing** — web/Drive research discovery + import (with
  **cancel**), notes CRUD, and public-link sharing.
- 🧱 **Solid by construction** — TypeScript strict mode, `undici` transport with
  network-fault classification + retry, and **183 unit tests** that pin the
  position-sensitive wire format against captured fixtures.

---

## 🆕 What's new — v0.2.0 Gemini Notebook rebrand

- Package renamed to `@cola_runner/gemini-notebook-cli`, with the
  `gemini-notebook` executable and `GeminiNotebookClient` SDK entry point.
- Runtime configuration now uses `GEMINI_NOTEBOOK_*` and
  `~/.config/gemini-notebook-cli`; this release intentionally provides no legacy
  aliases or storage migration.
- Browser login recognizes the current **Gemini Notebook** host
  (`notebook.google.com`) and no longer waits for the streaming app's `load` event.
- Generate vertical short-form videos with `generate video --format short`.
- Read the original prompt behind any studio artifact with `artifact get-prompt`.
- `whoami` now derives the account tier from the authoritative quota block rather
  than Google's promotions endpoint.

---

## 🆕 What's new — the 2026-06 product update

Google's [June 2026 update](https://techcrunch.com/2026/06/08/notebooklms-new-update-will-help-you-build-source-repository-from-chat/)
turned Gemini Notebook into an agentic researcher: **Gemini 3.5** as the default model,
**chat-driven source discovery**, **in-notebook code execution**, transparent
reasoning, and a wider set of export formats (`.docx`, Excel, PowerPoint, charts,
images). These are rolling out to **AI Ultra** and **Workspace business** accounts
first, then everyone.

Two things follow for this CLI:

- **`gemini-notebook whoami`** tells you which rollout your account is in — your
  subscription tier code plus notebook/source quotas. Use it to check whether the
  new agentic features are live for you yet.
- The new server-side capabilities (source discovery, code execution, the new
  export formats) ride on internal RPC endpoints we haven't reverse-engineered
  yet. **Status: tracking upstream [notebooklm-py](https://github.com/teng-lin/notebooklm-py).**
  Chat already benefits from Gemini 3.5 automatically once it reaches your account
  — no CLI change needed.

```bash
gemini-notebook whoami --json
# { "tier": "GEMINI_NOTEBOOK_TIER_ULTRA", "tierCode": 6, "tierLabel": "Ultra", "notebookLimit": …, "sourceLimit": … }
```

---

## 🚀 Install

```bash
npm install -g @cola_runner/gemini-notebook-cli     # global `gemini-notebook` command
# …or run without installing:
npx @cola_runner/gemini-notebook-cli login
```

The core install is tiny — just `commander` / `undici` / `tough-cookie`, no
browser. That's all an agent needs: authenticate headless with
`gemini-notebook login --paste` (paste a "Copy as cURL"/Cookie header), then every
other command is pure HTTP.

The one-click **browser** login is optional and needs Playwright:

```bash
npm i -g playwright && playwright install chromium   # only for `gemini-notebook login`
```

<details>
<summary><b>From source (contributors)</b></summary>

```bash
git clone https://github.com/cola-runner/gemini-notebook-cli.git && cd gemini-notebook-cli
pnpm install
pnpm build
pnpm playwright install chromium     # one-time, for browser login
npm link                             # puts `gemini-notebook` on your PATH
```

> No build step while hacking? Use `pnpm dev <command>` to run straight from source.
</details>

```bash
gemini-notebook login           # browser sign-in (or `login --paste` for headless)
gemini-notebook list            # confirm it worked
```

---

## 🧰 Commands

```bash
# Auth
gemini-notebook login                      # browser auto-capture (no keychain)
gemini-notebook login --paste              # or paste a "Copy as cURL" / Cookie header
gemini-notebook status                     # check auth state
gemini-notebook whoami                     # show your subscription tier + quotas

# Notebooks
gemini-notebook list
gemini-notebook create "My research"
gemini-notebook rename <nb> "New title"
gemini-notebook delete <nb>

# Sources
gemini-notebook source add <nb> --url https://en.wikipedia.org/wiki/SpaceX
gemini-notebook source add <nb> --text "..." --title "Notes"
gemini-notebook source add <nb> --file ./paper.pdf --wait   # upload a real PDF/image/docx/audio
gemini-notebook source list <nb>
gemini-notebook source list <nb> --label "Tax docs"          # only sources in a label

# Labels (group a notebook's sources by topic)
gemini-notebook label list <nb>
gemini-notebook label create <nb> "Tax docs" --emoji 📁
gemini-notebook label generate <nb>                          # AI auto-grouping (unlabeled sources)
gemini-notebook label assign <nb> <labelId> <sourceId...>
gemini-notebook label unassign <nb> <labelId> <sourceId...>
gemini-notebook label delete <nb> <labelId...>

# Chat (with citations + follow-ups)
gemini-notebook ask <nb> "What is this about?"
gemini-notebook ask <nb> "And what about that?" --conversation-id <id>
gemini-notebook suggest-prompts <nb>                          # AI-suggested questions to ask

# Notes
gemini-notebook note create <nb> --title "T" --content "..."
gemini-notebook note list <nb>

# Sharing
gemini-notebook share public <nb>          # anyone-with-link; prints the share URL
gemini-notebook share status <nb>

# Research (web/Drive discovery → import)
gemini-notebook research start <nb> "history of the Falcon 9" --wait
gemini-notebook research import <nb> <taskId> --limit 5
gemini-notebook research cancel <nb> <taskId>                 # stop an in-flight run

# Studio artifacts — generate & download
gemini-notebook generate audio <nb> --format deep-dive --wait
gemini-notebook generate video <nb> --format short --wait
gemini-notebook generate report <nb> --format study-guide --wait
gemini-notebook artifact list <nb>
gemini-notebook artifact get-prompt <nb> <artifactId>        # show the original generation prompt
gemini-notebook artifact retry <nb> <artifactId>             # re-run a failed artifact
gemini-notebook download audio <nb> ./overview.mp4
gemini-notebook download slide-deck <nb> ./deck.pdf
```

Add `--json` to any of the above for machine-readable output.

---

## 🧩 Programmatic API

```ts
import { GeminiNotebookClient } from '@cola_runner/gemini-notebook-cli';

const client = await GeminiNotebookClient.fromStorage();

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
| `sources` — add URL/YouTube/**file** (resumable upload) · list (+ `--label`) · delete · wait | ✅ |
| `labels` — create · list · **AI auto-grouping** · rename · assign/unassign · delete | ✅ |
| `chat` — ask · **citations** · **multi-turn** · **suggest-prompts** | ✅ |
| `artifacts` — generate (incl. **short video**) · list · **get prompt** · poll · download · delete · rename · export · retry | ✅ |
| `notes` (CRUD) · `share` (public link) · `research` (web/Drive · **cancel**) | ✅ |
| `whoami` — authoritative tier code + account quotas | ✅ |
| Mind maps · per-user share ACLs · save-answer-as-note | ⏳ planned |
| 2026-06 agentic update — source discovery · code exec · new exports | ⏳ tracking upstream |

---

## 🙏 Credits

Protocol groundwork and RPC method IDs come from
[notebooklm-py](https://github.com/teng-lin/notebooklm-py). This is an
independent TypeScript reimplementation with an agent-first CLI.

## 📄 License

[MIT](LICENSE)

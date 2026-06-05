# notebooklm-node

Unofficial NotebookLM client for Node.js — TypeScript port of [notebooklm-py](https://github.com/teng-lin/notebooklm-py).

**⚠️ Work in progress.** Only foundational layers and a subset of APIs are implemented so far.

## Status

| Layer | Status |
|---|---|
| RPC encoder/decoder | ✅ |
| Auth + cookie storage | ✅ |
| Session/transport | ✅ |
| `notebooks` API (list/create/get/rename/delete) | ✅ |
| `sources` API (add URL/YouTube/text, list, delete, wait) | ✅ |
| `chat` API (ask, conversation id) | ✅ |
| `artifacts` API (generate/list/poll/download/delete/rename/export) | ✅ |
| `research` / `notes` / `share` | ⏳ |
| CLI (login, list, create, source, ask, generate, artifact, download) | ✅ |

56 unit tests passing across encoder, decoder, sources, chat, and artifact parsing.

Artifacts covered: Audio Overview, Video Overview (incl. cinematic), Report
(briefing doc / study guide / blog post / custom), Quiz, Flashcards,
Infographic, Slide Deck, Data Table. Mind maps depend on the not-yet-ported
notes system and are deferred.

## Install

```bash
pnpm install
pnpm playwright install chromium
```

## Usage

```bash
pnpm dev login                                  # opens Chromium for Google login
pnpm dev status                                 # check auth state
pnpm dev list                                   # list notebooks
pnpm dev create "My research"                   # create a notebook (prints id)
pnpm dev rename <nb_id> "New title"             # rename a notebook
pnpm dev delete <nb_id>                         # delete a notebook (irreversible)
pnpm dev source add <nb_id> --url https://...   # add a URL or YouTube source
pnpm dev source add <nb_id> --text "..." --title "Notes"
pnpm dev source list <nb_id>                    # list sources
pnpm dev ask <nb_id> "What is this about?"      # ask a question

# Generate & download studio artifacts
pnpm dev generate audio <nb_id> --format deep-dive --wait   # podcast (blocks until ready)
pnpm dev generate report <nb_id> --format study-guide --wait
pnpm dev artifact list <nb_id>                              # list generated artifacts
pnpm dev download audio <nb_id> ./overview.mp4             # latest completed audio
pnpm dev download slide-deck <nb_id> ./deck.pdf --format pdf
pnpm dev download quiz <nb_id> ./quiz.md --format markdown
```

End-to-end smoke flow:

```bash
NB=$(pnpm dev create "demo" --json | jq -r .id)   # every data command supports --json
pnpm dev source add "$NB" --url https://en.wikipedia.org/wiki/Erlang_(programming_language) --wait
pnpm dev ask "$NB" "Summarize the article in one paragraph."
```

## License

MIT

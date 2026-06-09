# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An **unofficial** Node.js/TypeScript client for Google NotebookLM. It talks to NotebookLM's
internal `batchexecute` RPC endpoints (no public API exists), shipped as both a programmatic
library (`NotebookLMClient`) and an **agent-first CLI** (`notebooklm`). The protocol layer is a
TypeScript port of [notebooklm-py](https://github.com/teng-lin/notebooklm-py) — many files cite
the upstream Python module they were ported from, and that project is the source of truth for
wire-format details.

## Commands

Package manager is **pnpm** (there is a `pnpm-lock.yaml`).

```bash
pnpm dev <command...>          # run the CLI from source via tsx, no build (e.g. pnpm dev list)
pnpm build                     # tsc -p tsconfig.build.json → dist/ (src only, excludes tests)
pnpm test                      # vitest run (99 unit tests)
pnpm test:watch                # vitest watch mode
pnpm vitest run tests/unit/encoder.test.ts          # run a single test file
pnpm vitest run -t 'nestSourceIds'                  # run tests matching a name
pnpm typecheck                 # tsc --noEmit (full strict check incl. tests)
pnpm lint                      # biome check src tests
pnpm lint:fix                  # biome check --write (autofix)
pnpm format                    # biome format --write
```

TypeScript is maximally strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`verbatimModuleSyntax`, etc.). All imports use explicit `.js` extensions (NodeNext ESM) even for
`.ts` source files. Biome enforces single quotes, 2-space indent, 100-col width, trailing commas.

## Architecture

The stack is strictly layered; a request flows **CLI → NotebookLMClient → feature API → Session →
Transport → RPC encode/decode**.

- **`src/rpc/`** — the wire protocol, ported verbatim from notebooklm-py.
  - `types.ts` holds the **obfuscated RPC method IDs** (`RPCMethod`, e.g. `LIST_NOTEBOOKS:
    'wXbhsf'`) plus all artifact/format enums. Google changes these IDs without notice; this file
    must be kept in sync with upstream. **Escape hatch:** the `NOTEBOOKLM_RPC_OVERRIDES` env var
    (`overrides.ts`) patches IDs at runtime without a release.
  - `encoder.ts` builds the `f.req` body — the format is a triple-nested array
    `[[[rpcId, jsonParams, null, "generic"]]]`, URL-encoded. `nestSourceIds(ids, depth)` wraps
    source IDs in N layers of arrays — generation params demand specific nesting depths.
  - `decoder.ts` parses the chunked anti-XSSI response (`)]}'` prefix, alternating byte-count /
    JSON lines, `["wrb.fr", id, result, …]` or `["er", …]` envelopes) and raises the typed errors.
  - **Request/response params are position-sensitive nested arrays** (`[[2], notebookId, [null,
    null, typeCode, …]]`). Positions and `null` padding matter — an off-by-one silently makes the
    backend drop config and return no result. Read with `safeIndex()` (returns `undefined` OOB; set
    `NOTEBOOKLM_STRICT_DECODE=1` to throw and catch shape regressions in dev).
- **`src/session/`** — `Session` caches auth tokens (CSRF + session id, 25-min TTL, lazily
  re-extracted from the homepage HTML), dispatches RPC calls, and retries once on `AuthError`.
  `Transport` (undici) owns cookies, Set-Cookie persistence, retry/backoff for 429/5xx + transient
  socket faults, the keepalive `RotateCookies` poke, and the multi-hop signed-URL download chain.
- **`src/api/`** — one class per feature domain (`notebooks`, `sources`, `chat`, `artifacts`,
  `notes`, `share`, `research`, `user`), each constructed with a `Session` and exposed as a field
  on `NotebookLMClient` (`src/client.ts`). API methods build the nested params, call
  `session.call('METHOD_NAME', params, { allowNull? })`, and parse the result.
- **`src/cli/`** — `index.ts` wires up Commander; `artifactCommands.ts` registers the
  `generate`/`artifact`/`download` subtrees. `output.ts` defines the agent contract (see below).
- **`src/auth/`** — `storage_state.json` is Playwright-compatible (same shape as
  `BrowserContext.storageState()`). Default path `~/.config/notebooklm-cli/storage_state.json`,
  overridable via `--storage` or `NOTEBOOKLM_STORAGE`. Login has three paths: browser auto-capture
  (`loginBrowser.ts`, the only thing needing Playwright — an optional peer dep), paste-a-cURL
  (`loginPaste.ts` / `curlCookies.ts`), and macOS Chrome cookie decrypt (`chromeCookies.ts`).

### Three HTTP paths, not one

Most operations go through the `batchexecute` RPC (`Session.call`). Two endpoints don't:
- **Chat** (`api/chat.ts`) posts to a streaming endpoint (`GenerateFreeFormStreamed`) with a
  different body shape (`f.req = [null, jsonParams]`, no triple nesting) and parses a stream of
  `wrb.fr` envelopes for answer text + citations. Don't assume the RPC encoder/decoder applies.
- **File upload** (`api/sources.ts` `addFile` + `api/sourceUpload.ts`) is a Google "Scotty"
  resumable upload to `/upload/_/` (`getUploadUrl()`): register via `ADD_SOURCE_FILE` →
  `start` handshake (read session URL from the `x-goog-upload-url` response header) → stream bytes
  with `x-goog-upload-command: upload, finalize`. `validateResumableUploadUrl` pins the returned
  URL to the configured host/path before sending bytes. `ADD_SOURCE_FILE` is the one RPC that needs
  a non-default `source-path` (`/notebook/<id>`) — hence the `sourcePath` option on `Session.call`.

### The agent-first CLI contract (`src/cli/output.ts`)

This is the project's core design invariant — preserve it when adding commands:
- Every data command takes `--json`. Results go to **stdout**, progress/logs to **stderr**.
- Errors are data: under `--json`, failures print `{ "error": { "code", "message", … } }` to
  **stdout** (not stderr) so a single `out=$(cmd --json)` capture always parses.
- **Exit codes are a stable contract** keyed off the error class (`EXIT` map): `0` OK, `2` USAGE,
  `3` AUTH, `4` NOT_FOUND, `5` NOT_READY, `6` RATE_LIMIT, `7` RPC, `8` NETWORK. `classifyError()`
  maps the error hierarchy (`src/rpc/errors.ts`) to these codes. New commands should `emit()` on
  success and `fail(opts, err)` on error rather than printing/exiting ad hoc.

The CLI opens clients with `disableKeepalive: true` + `readOnlyStorage: true` (see
`cli/helpers.ts`): each invocation is a short-lived process, and rotating `__Secure-1PSIDTS` per
call across processes degrades the session and causes homepage redirect loops.

## Testing

Unit tests live in `tests/unit/*.test.ts` (vitest, node env). They exercise the pure logic —
encoder/decoder wire format, citation/artifact parsing, generation param shapes, CLI output
classification — by feeding captured response fixtures, not by hitting the live API. When changing
nested param construction or response parsing, add/adjust a fixture-based test; the param-shape
tests (`generationParams.test.ts`, `encoder.test.ts`) are the guardrail against off-by-one nesting
bugs that the live backend silently swallows.

## Useful env vars

- `NOTEBOOKLM_RPC_OVERRIDES` — JSON map of `MethodName → rpcId` to patch drifted IDs.
- `NOTEBOOKLM_STORAGE` — override the storage_state.json path.
- `NOTEBOOKLM_DEBUG=1` — verbose redirect/download logging; disables response-preview truncation.
- `NOTEBOOKLM_STRICT_DECODE=1` — make `safeIndex` throw on OOB to surface response-shape drift.
- `NOTEBOOKLM_HL` — default interface language for artifact generation (default `en`).
- `NOTEBOOKLM_BASE_URL` — base URL; host is allowlisted to `notebooklm.google.com`.

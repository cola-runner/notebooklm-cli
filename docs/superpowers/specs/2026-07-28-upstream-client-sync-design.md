# Upstream Client Sync Design

Date: 2026-07-28

## Context

`@cola_runner/notebooklm-cli` is a TypeScript port of the protocol and selected
client features from `teng-lin/notebooklm-py`. The local project is currently at
version `0.1.2`; its most recent upstream sync on 2026-06-25 covered the important
client-facing changes available around `notebooklm-py` `v0.7.2`.

The Python upstream is now at `v0.8.0rc1` plus several main-branch fixes. Most of
the upstream delta concerns Python-only MCP, REST, deployment, and headless-auth
adapters. This sync deliberately ports only small, client-relevant changes that
fit the existing TypeScript architecture.

## Goals

- Keep browser login working after the NotebookLM to Gemini Notebook rebrand.
- Upload Markdown files with the MIME type expected by NotebookLM.
- Expose the upstream short-form video generation format.
- Let callers retrieve the prompt stored on a generated artifact.
- Report account tier from the authoritative account-limits response.
- Preserve the CLI's JSON-first output and stable exit-code contract.
- Ship the changes as package version `0.1.3`, with focused documentation and
  regression tests.

## Non-goals

- Porting the upstream MCP server, REST server, Docker deployment, upload widget,
  OAuth server, master-token authentication, or Python-specific transport work.
- Reaching complete feature parity with `notebooklm-py` `v0.8.0rc1`.
- Adding a scheduled upstream watcher or GitHub Issue automation.
- Publishing the npm package or pushing changes to a remote repository.

## Design

### Login host compatibility

The interactive Playwright login flow will accept both the legacy
`notebooklm.google.com` host and the new personal-product host
`notebook.google.com` as successful authenticated destinations. Enterprise and
RPC base-host validation remain unchanged. Navigation that waits for the
authenticated single-page app will use Playwright's `commit` readiness level so
the flow does not depend on a `load` event the streaming app may never emit.

This is limited to login-success detection. API calls continue to use the
existing configured base URL.

### Markdown upload MIME

The upload MIME resolver will return `text/markdown` for `.md` and `.markdown`
files, case-insensitively, before applying the generic fallback. Other known
extensions and the current `application/octet-stream` fallback remain
unchanged.

### Short-form video

`VideoFormat` will gain `SHORT: 4`. The programmatic artifact API and CLI will
accept the value `short`. Because the NotebookLM server ignores visual style for
short-form video, the client will reject a non-default style or custom visual
prompt when `short` is selected instead of silently dropping user input.

The request will otherwise use the existing video-generation envelope and wire
format, with the new format code in the established format slot.

### Artifact generation prompt

Artifact parsing will retain the generation prompt already present in
`LIST_ARTIFACTS` rows. The public artifact type will expose it as an optional
field, and `ArtifactsAPI.getPrompt(notebookId, artifactId)` will:

- return the stored prompt when present;
- return `null` when the artifact exists but has no prompt;
- raise the existing not-found error when the artifact ID does not exist.

The CLI will add `artifact get-prompt <notebookId> <artifactId>` and preserve the
normal `--json` success/error behavior.

### Authoritative account tier

`whoami` will derive the account tier from the limits block returned by
`GET_USER_SETTINGS`, alongside notebook and source quotas. It will stop treating
the promotions-oriented `GET_USER_TIER` response as authoritative.

The wire tier value will remain available as an opaque numeric/string value, and
the CLI will map known values to conservative labels:

- `1`: Free
- `2`: Pro
- `4`: Plus
- `3` or `6`: Ultra
- `5`: Expanded

Unknown values will be reported without inventing a plan name. Existing quota
fields remain stable.

## Error handling

- Login rejects unrelated hosts exactly as before.
- Unsupported short-video style combinations fail locally as validation/usage
  errors before consuming generation quota.
- Missing artifacts use the existing typed not-found error and CLI exit code.
- Malformed account settings degrade to an unknown tier while retaining any
  independently decoded quota values; they must not be mislabeled as a paid
  plan.

## Testing

Implementation follows red-green-refactor:

- login-host tests cover legacy, rebranded, and unrelated hosts;
- upload tests cover `.md`, `.markdown`, uppercase extensions, and fallback;
- generation-param tests pin short-video format code and invalid style cases;
- artifact parser/API tests cover prompt, prompt absence, and missing ID;
- CLI tests cover text and JSON prompt output;
- account tests cover all known authoritative tier codes and an unknown code.

After focused tests pass, run the full project verification:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

## Documentation and release metadata

Update `README.md`, `CLAUDE.md` where its architecture notes would otherwise be
stale, `package.json`, and `pnpm-lock.yaml` for version `0.1.3`. Do not publish,
tag, push, or create a release as part of this task.

# Upstream Client Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@cola_runner/notebooklm-cli` 0.1.3 with the client-relevant compatibility and feature updates selected from `notebooklm-py` v0.8.0rc1.

**Architecture:** Keep every change inside the existing TypeScript layers: login compatibility in `src/cli/loginBrowser.ts`, wire enums and artifact parsing in the RPC/artifact modules, feature behavior in `ArtifactsAPI` and `UserAPI`, and thin Commander adapters in the CLI. Reuse `LIST_ARTIFACTS` and `GET_USER_SETTINGS`; no new RPC methods or dependencies are required.

**Tech Stack:** Node.js 20+, TypeScript with NodeNext ESM, Commander, Playwright (optional peer), Vitest, Biome, pnpm.

## Global Constraints

- Preserve the JSON-first CLI contract: results on stdout, progress on stderr, structured JSON errors, and existing exit codes.
- Keep explicit `.js` suffixes on TypeScript imports.
- Keep strict TypeScript settings, 2-space indentation, single quotes, and 100-column formatting.
- Do not port MCP, REST, Docker, OAuth-server, upload-widget, or master-token features.
- Do not add scheduled upstream automation.
- Do not publish, tag, push, or create a release.
- Follow red-green-refactor for every production behavior change.
- Markdown MIME support is already present in `src/api/sourceUpload.ts` and covered by `tests/unit/sourceUpload.test.ts`; verify it but do not reimplement it.

---

## File Map

- `src/cli/loginBrowser.ts`: browser navigation readiness and accepted authenticated app hosts.
- `tests/unit/loginBrowser.test.ts`: pure login URL and navigation-option regression tests.
- `src/rpc/types.ts`: short-form video wire enum.
- `src/api/artifacts.ts`: short-video validation and artifact prompt lookup.
- `src/artifactParse.ts`: type-specific generation-prompt extraction.
- `src/cli/artifactCommands.ts`: video format/style options and `artifact get-prompt`.
- `tests/unit/generationParams.test.ts`: short-video request and validation tests.
- `tests/unit/artifacts.test.ts`: prompt extraction tests for artifact row shapes.
- `tests/unit/artifactPrompt.test.ts`: `ArtifactsAPI.getPrompt` behavior.
- `tests/unit/artifactCommands.test.ts`: Commander surface registration.
- `src/api/user.ts`: authoritative tier extraction from `GET_USER_SETTINGS`.
- `src/types.ts`: backward-compatible `UserAccount` tier metadata.
- `src/cli/index.ts`: updated `whoami` human renderer.
- `tests/unit/userTier.test.ts`: tier-code parsing and single-RPC behavior.
- `README.md`, `CLAUDE.md`: user-facing feature and architecture notes.
- `package.json`: version `0.1.3`.

---

### Task 1: Rebranded Login Destination Compatibility

**Files:**
- Create: `tests/unit/loginBrowser.test.ts`
- Modify: `src/cli/loginBrowser.ts`

**Interfaces:**
- Produces: `isNotebookAppUrl(rawUrl: string, baseUrl?: string): boolean`.
- Produces: `navigateToNotebookApp(page: Pick<Page, 'goto'>, baseUrl: string): Promise<void>`.
- `captureSession` consumes the configured base URL and requires both valid cookies and an accepted app destination.

- [ ] **Step 1: Write failing host-acceptance tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  isNotebookAppUrl,
  navigateToNotebookApp,
} from '../../src/cli/loginBrowser.js';

describe('isNotebookAppUrl', () => {
  it('accepts the legacy and rebranded personal hosts', () => {
    expect(isNotebookAppUrl('https://notebooklm.google.com/', 'https://notebooklm.google.com'))
      .toBe(true);
    expect(isNotebookAppUrl('https://notebook.google.com/', 'https://notebooklm.google.com'))
      .toBe(true);
  });

  it('keeps a configured custom base host and rejects unrelated hosts', () => {
    expect(isNotebookAppUrl('https://notes.example.com/', 'https://notes.example.com')).toBe(true);
    expect(isNotebookAppUrl('https://accounts.google.com/', 'https://notebooklm.google.com'))
      .toBe(false);
    expect(isNotebookAppUrl('not a url', 'https://notebooklm.google.com')).toBe(false);
  });
});

describe('navigateToNotebookApp', () => {
  it('waits only for navigation commit', async () => {
    const goto = vi.fn(async () => null);
    await navigateToNotebookApp({ goto } as never, 'https://notebooklm.google.com');
    expect(goto).toHaveBeenCalledWith('https://notebooklm.google.com/', {
      waitUntil: 'commit',
    });
  });
});
```

- [ ] **Step 2: Run the test and confirm the expected RED state**

Run:

```bash
pnpm vitest run tests/unit/loginBrowser.test.ts
```

Expected: FAIL because `isNotebookAppUrl` and `navigateToNotebookApp` are not exported.

- [ ] **Step 3: Implement the minimal login helpers and use them**

Add URL normalization that accepts:

```ts
host === new URL(baseUrl).hostname ||
  (new URL(baseUrl).hostname === 'notebooklm.google.com' &&
    host === 'notebook.google.com')
```

Use `waitUntil: 'commit'` in `navigateToNotebookApp`. Pass `baseUrl` into
`captureSession` and only finish capture when required cookies exist and at
least one open page satisfies `isNotebookAppUrl(page.url(), baseUrl)`.

- [ ] **Step 4: Run the focused test**

Run:

```bash
pnpm vitest run tests/unit/loginBrowser.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the login compatibility change**

```bash
git add src/cli/loginBrowser.ts tests/unit/loginBrowser.test.ts
git commit -m "fix(auth): support Gemini Notebook login host"
```

---

### Task 2: Short-Form Video Generation

**Files:**
- Modify: `src/rpc/types.ts`
- Modify: `src/api/artifacts.ts`
- Modify: `src/cli/artifactCommands.ts`
- Modify: `tests/unit/generationParams.test.ts`
- Create: `tests/unit/artifactCommands.test.ts`

**Interfaces:**
- Produces: `VideoFormat.SHORT === 4`.
- `ArtifactsAPI.generateVideo` accepts `videoFormat: VideoFormat.SHORT`.
- CLI: `generate video <notebookId> --format short`.
- CLI also exposes existing API controls through `--style` and `--style-prompt`.

- [ ] **Step 1: Write failing short-video wire tests**

Extend `tests/unit/generationParams.test.ts`:

```ts
import {
  ArtifactStatus,
  InfographicDetail,
  InfographicOrientation,
  VideoFormat,
  VideoStyle,
} from '../../src/rpc/types.js';

it('sends short-form video as format code 4', async () => {
  const { api, lastParams } = makeApi();
  await api.generateVideo('nb', { videoFormat: VideoFormat.SHORT });
  expect(videoConfig(lastParams())[4]).toBe(4);
});

it('rejects explicit styles for short-form video', async () => {
  const { api } = makeApi();
  await expect(
    api.generateVideo('nb', {
      videoFormat: VideoFormat.SHORT,
      videoStyle: VideoStyle.ANIME,
    }),
  ).rejects.toThrow(/fixed visual style/);
  await expect(
    api.generateVideo('nb', {
      videoFormat: VideoFormat.SHORT,
      stylePrompt: 'watercolor',
    }),
  ).rejects.toThrow(/fixed visual style/);
});
```

- [ ] **Step 2: Run the generation tests and confirm RED**

Run:

```bash
pnpm vitest run tests/unit/generationParams.test.ts
```

Expected: FAIL because `VideoFormat.SHORT` does not exist.

- [ ] **Step 3: Add the short enum and minimal validation**

Change the enum to:

```ts
export const VideoFormat = {
  EXPLAINER: 1,
  BRIEF: 2,
  CINEMATIC: 3,
  SHORT: 4,
} as const;
```

Before the existing custom-style validation in `generateVideo`, reject:

```ts
if (
  opts.videoFormat === VideoFormatEnum.SHORT &&
  ((opts.videoStyle !== undefined && opts.videoStyle !== VideoStyleEnum.AUTO_SELECT) ||
    stylePrompt)
) {
  throw new ArtifactError(
    'videoStyle and stylePrompt are not supported for short videos (short has a fixed visual style)',
  );
}
```

- [ ] **Step 4: Run the generation tests and confirm GREEN**

Run:

```bash
pnpm vitest run tests/unit/generationParams.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write a failing CLI registration test**

Create `tests/unit/artifactCommands.test.ts`:

```ts
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerArtifactCommands } from '../../src/cli/artifactCommands.js';

it('registers the short-video CLI surface', () => {
  const program = new Command();
  registerArtifactCommands(program);
  const generate = program.commands.find((command) => command.name() === 'generate');
  const video = generate?.commands.find((command) => command.name() === 'video');
  expect(video?.options.find((option) => option.long === '--format')?.description)
    .toContain('short');
  expect(video?.options.some((option) => option.long === '--style')).toBe(true);
  expect(video?.options.some((option) => option.long === '--style-prompt')).toBe(true);
});
```

- [ ] **Step 6: Run the CLI test and confirm RED**

Run:

```bash
pnpm vitest run tests/unit/artifactCommands.test.ts
```

Expected: FAIL because the video options are absent.

- [ ] **Step 7: Add the video CLI options and mappings**

On `generate video`, add:

```ts
.option('--format <fmt>', 'explainer | brief | cinematic | short')
.option(
  '--style <style>',
  'auto | classic | whiteboard | kawaii | anime | watercolor | retro-print | heritage | paper-craft | custom',
)
.option('--style-prompt <text>', 'Custom visual style prompt (requires --style custom)')
```

Map the strings to `VideoFormat` and `VideoStyle`, then pass `videoFormat`,
`videoStyle`, and `stylePrompt` to `generateVideo`. Unknown strings throw
`ArtifactError` instead of being silently ignored.

- [ ] **Step 8: Run the focused generation test**

Run:

```bash
pnpm vitest run tests/unit/generationParams.test.ts tests/unit/artifactCommands.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit short-video support**

```bash
git add src/rpc/types.ts src/api/artifacts.ts src/cli/artifactCommands.ts \
  tests/unit/generationParams.test.ts tests/unit/artifactCommands.test.ts
git commit -m "feat(video): add short-form generation"
```

---

### Task 3: Artifact Generation Prompt API and CLI

**Files:**
- Modify: `src/artifactParse.ts`
- Modify: `src/api/artifacts.ts`
- Modify: `src/cli/artifactCommands.ts`
- Modify: `tests/unit/artifacts.test.ts`
- Create: `tests/unit/artifactPrompt.test.ts`
- Modify: `tests/unit/artifactCommands.test.ts`

**Interfaces:**
- Produces: `extractArtifactGenerationPrompt(data, artifactType): string | undefined`.
- Adds: `Artifact.generationPrompt?: string`.
- Adds: `ArtifactsAPI.getPrompt(notebookId, artifactId): Promise<string | null>`.
- CLI JSON result: `{ notebookId, id, prompt }`.

- [ ] **Step 1: Write failing parser tests for the upstream prompt locations**

Add table-driven cases to `tests/unit/artifacts.test.ts`:

```ts
it.each([
  [ArtifactTypeCode.AUDIO, { 6: [null, ['audio prompt']] }],
  [ArtifactTypeCode.REPORT, { 7: [null, [null, null, null, null, null, 'report prompt']] }],
  [ArtifactTypeCode.VIDEO, { 8: [null, null, [null, null, 'video prompt']] }],
  [ArtifactTypeCode.QUIZ, { 9: [null, [2, null, 'quiz prompt']] }],
  [ArtifactTypeCode.INFOGRAPHIC, { 14: [['infographic prompt']] }],
  [ArtifactTypeCode.SLIDE_DECK, { 16: [['slides prompt']] }],
  [ArtifactTypeCode.DATA_TABLE, { 18: [null, ['table prompt']] }],
])('extracts the generation prompt for artifact type %s', (type, slots) => {
  const artifact = parseArtifact(row({ 0: 'a', 2: type, ...slots }));
  expect(artifact?.generationPrompt).toMatch(/prompt$/);
});

it('leaves the prompt absent when the slot is missing or non-string', () => {
  expect(parseArtifact(row({ 0: 'a', 2: ArtifactTypeCode.AUDIO }))?.generationPrompt)
    .toBeUndefined();
  expect(
    parseArtifact(row({ 0: 'a', 2: ArtifactTypeCode.AUDIO, 6: [null, [42]] }))
      ?.generationPrompt,
  ).toBeUndefined();
});
```

- [ ] **Step 2: Run parser tests and confirm RED**

Run:

```bash
pnpm vitest run tests/unit/artifacts.test.ts
```

Expected: FAIL because `generationPrompt` is absent.

- [ ] **Step 3: Implement type-specific prompt extraction**

Use the upstream paths:

```ts
const PROMPT_PATHS: Record<number, readonly number[]> = {
  [ArtifactTypeCode.AUDIO]: [6, 1, 0],
  [ArtifactTypeCode.REPORT]: [7, 1, 5],
  [ArtifactTypeCode.VIDEO]: [8, 2, 2],
  [ArtifactTypeCode.QUIZ]: [9, 1, 2],
  [ArtifactTypeCode.INFOGRAPHIC]: [14, 0, 0],
  [ArtifactTypeCode.SLIDE_DECK]: [16, 0, 0],
  [ArtifactTypeCode.DATA_TABLE]: [18, 1, 0],
};
```

Walk the path defensively. Return `undefined` if any hop is absent/non-array or
the leaf is not a string. Populate `Artifact.generationPrompt` only when
defined.

- [ ] **Step 4: Run parser tests and confirm GREEN**

Run:

```bash
pnpm vitest run tests/unit/artifacts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing API lookup tests**

Create `tests/unit/artifactPrompt.test.ts` with a fake `Session` whose
`LIST_ARTIFACTS` response contains one prompted artifact:

```ts
it('returns a stored generation prompt', async () => {
  const api = makeApi([[rowWithPrompt('a1', 'Summarize the sources')]]);
  await expect(api.getPrompt('nb', 'a1')).resolves.toBe('Summarize the sources');
});

it('returns null when a known artifact has no prompt', async () => {
  const api = makeApi([[rowWithoutPrompt('a1')]]);
  await expect(api.getPrompt('nb', 'a1')).resolves.toBeNull();
});

it('raises the typed not-found error for an unknown artifact', async () => {
  const api = makeApi([[rowWithoutPrompt('a1')]]);
  await expect(api.getPrompt('nb', 'missing')).rejects.toBeInstanceOf(ArtifactNotFoundError);
});
```

- [ ] **Step 6: Run the API test and confirm RED**

Run:

```bash
pnpm vitest run tests/unit/artifactPrompt.test.ts
```

Expected: FAIL because `ArtifactsAPI.getPrompt` does not exist.

- [ ] **Step 7: Add `ArtifactsAPI.getPrompt`**

Implement:

```ts
async getPrompt(notebookId: string, artifactId: string): Promise<string | null> {
  const artifact = await this.get(notebookId, artifactId);
  if (!artifact) {
    throw new ArtifactNotFoundError(`artifact not found: ${artifactId}`);
  }
  return artifact.generationPrompt ?? null;
}
```

- [ ] **Step 8: Run API tests and confirm GREEN**

Run:

```bash
pnpm vitest run tests/unit/artifactPrompt.test.ts
```

Expected: PASS.

- [ ] **Step 9: Extend the CLI test with a failing prompt-command assertion**

Add to `tests/unit/artifactCommands.test.ts`:

```ts
const artifact = program.commands.find((command) => command.name() === 'artifact');
expect(artifact?.commands.some((command) => command.name() === 'get-prompt')).toBe(true);
```

Run:

```bash
pnpm vitest run tests/unit/artifactCommands.test.ts
```

Expected: FAIL because `get-prompt` is not registered.

- [ ] **Step 10: Add the `artifact get-prompt` command**

Register:

```ts
artifact
  .command('get-prompt <notebookId> <artifactId>')
  .description('Show the generation prompt behind an artifact')
  .option('--storage <path>', 'Override storage_state.json path')
  .option('--json', 'Output as JSON', false)
```

Call `client.artifacts.getPrompt`, save the client, then emit:

```ts
{ notebookId, id: artifactId, prompt }
```

Human output prints the prompt verbatim, or
`This artifact has no stored prompt.` when it is `null`.

- [ ] **Step 11: Run artifact-focused tests**

Run:

```bash
pnpm vitest run tests/unit/artifacts.test.ts \
  tests/unit/artifactPrompt.test.ts \
  tests/unit/artifactCommands.test.ts
```

Expected: PASS.

- [ ] **Step 12: Commit artifact prompt support**

```bash
git add src/artifactParse.ts src/api/artifacts.ts src/cli/artifactCommands.ts \
  tests/unit/artifacts.test.ts tests/unit/artifactPrompt.test.ts \
  tests/unit/artifactCommands.test.ts
git commit -m "feat(artifacts): expose generation prompts"
```

---

### Task 4: Authoritative Account Tier Parsing

**Files:**
- Modify: `src/api/user.ts`
- Modify: `src/types.ts`
- Modify: `src/cli/index.ts`
- Modify: `tests/unit/userTier.test.ts`

**Interfaces:**
- Adds: `UserAccount.tierCode?: number`, the raw positive integer from limits index 4.
- Preserves: `UserAccount.tier?: string` as a compatibility constant derived
  from the authoritative code.
- Replaces: `tierLabelFor(string | undefined)` with
  `tierLabelForCode(number | undefined)`.
- `UserAPI.whoami` makes one `GET_USER_SETTINGS` call and no `GET_USER_TIER`
  call.

- [ ] **Step 1: Replace old tests with failing authoritative-tier tests**

Update `tests/unit/userTier.test.ts`:

```ts
import {
  parseUserSettings,
  tierConstantForCode,
  tierLabelForCode,
  UserAPI,
} from '../../src/api/user.js';

it.each([
  [1, 'Free'],
  [2, 'Pro'],
  [4, 'Plus'],
  [3, 'Ultra'],
  [6, 'Ultra'],
  [5, 'Expanded'],
])('maps tier code %s to %s', (code, label) => {
  expect(tierLabelForCode(code)).toBe(label);
});

it('does not invent a label for unknown or absent codes', () => {
  expect(tierLabelForCode(99)).toBe('Unknown (99)');
  expect(tierLabelForCode(undefined)).toBe('Unknown');
});

it('extracts the tier from limits index 4', () => {
  const fixture = [
    [null, [6, 500, 300, 500000, 2], [true, null, null, true, ['ja']]],
  ];
  expect(parseUserSettings(fixture)).toEqual({
    notebookLimit: 500,
    sourceLimit: 300,
    tierCode: 2,
    language: 'ja',
  });
});

it('fetches settings once and derives the compatibility tier', async () => {
  const calls: string[] = [];
  const session = {
    call: async (method: string) => {
      calls.push(method);
      return [[null, [6, 500, 300, 500000, 2], [true, null, null, true, ['en']]]];
    },
  } as never;
  const account = await new UserAPI(session).whoami();
  expect(calls).toEqual(['GET_USER_SETTINGS']);
  expect(account).toEqual({
    tier: 'NOTEBOOKLM_TIER_PRO',
    tierCode: 2,
    tierLabel: 'Pro',
    notebookLimit: 500,
    sourceLimit: 300,
    language: 'en',
  });
});
```

`tierConstantForCode` maps `1/2/4/3|6/5` to
`NOTEBOOKLM_TIER_STANDARD/PRO/PLUS/ULTRA/EXPANDED`.

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
pnpm vitest run tests/unit/userTier.test.ts
```

Expected: FAIL because numeric tier parsing and the new helpers do not exist.

- [ ] **Step 3: Implement settings-only `whoami`**

Remove `tierParams`, `parseUserTier`, the recursive promotions-tier scan, and
the `GET_USER_TIER` call. Extend `parseUserSettings` with:

```ts
tierCode?: number;
```

Only accept positive integer codes and reject booleans/non-integers. Build the
account from the single settings response:

```ts
const tierCode = settings.tierCode;
const tier = tierConstantForCode(tierCode);
const account: UserAccount = { tierLabel: tierLabelForCode(tierCode) };
if (tier !== undefined) account.tier = tier;
if (tierCode !== undefined) account.tierCode = tierCode;
```

If `GET_USER_SETTINGS` fails, propagate the error; there is no longer a
promotions response to fall back to.

- [ ] **Step 4: Update public types and the human renderer**

Add `tierCode?: number` to `UserAccount` and document that `tier` is the
backward-compatible symbolic form. In `whoami`, print the numeric code when
present and use `tierCode === 3 || tierCode === 6` for the Ultra eligibility
message.

- [ ] **Step 5: Run the focused tier tests**

Run:

```bash
pnpm vitest run tests/unit/userTier.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit authoritative tier parsing**

```bash
git add src/api/user.ts src/types.ts src/cli/index.ts tests/unit/userTier.test.ts
git commit -m "fix(user): derive tier from account limits"
```

---

### Task 5: Release Metadata, Documentation, and Verification

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `package.json`
- Verify: `pnpm-lock.yaml`
- Verify: `tests/unit/sourceUpload.test.ts`

**Interfaces:**
- Package version becomes `0.1.3`.
- README documents `generate video --format short` and
  `artifact get-prompt`.
- Architecture notes describe numeric authoritative tier parsing and both
  personal login hosts.

- [ ] **Step 1: Verify the already-present Markdown MIME behavior**

Run:

```bash
pnpm vitest run tests/unit/sourceUpload.test.ts
```

Expected: PASS, including `notes.md -> text/markdown`. Inspect
`MIME_BY_EXT` to confirm both `.md` and `.markdown` are present and extension
matching is case-insensitive via `.toLowerCase()`.

- [ ] **Step 2: Update package and docs**

Change `package.json` version from `0.1.2` to `0.1.3`. Update README command
examples and highlights with:

```bash
notebooklm generate video <nb> --format short --wait
notebooklm artifact get-prompt <nb> <artifactId>
```

Replace stale wording that `GET_USER_TIER` is authoritative. Note that login
supports both `notebooklm.google.com` and the rebranded
`notebook.google.com`.

- [ ] **Step 3: Refresh lockfile metadata**

Run:

```bash
pnpm install --lockfile-only
```

Expected: exit 0. `pnpm-lock.yaml` may remain unchanged because pnpm lockfile
v9 does not record the root package version; do not manufacture a diff.

- [ ] **Step 4: Run formatting on changed code and tests**

Run:

```bash
pnpm exec biome format --write \
  src/cli/loginBrowser.ts \
  src/rpc/types.ts \
  src/api/artifacts.ts \
  src/artifactParse.ts \
  src/cli/artifactCommands.ts \
  src/api/user.ts \
  src/types.ts \
  src/cli/index.ts \
  tests/unit/loginBrowser.test.ts \
  tests/unit/generationParams.test.ts \
  tests/unit/artifacts.test.ts \
  tests/unit/artifactPrompt.test.ts \
  tests/unit/artifactCommands.test.ts \
  tests/unit/userTier.test.ts
```

Expected: exit 0.

- [ ] **Step 5: Run the full verification suite**

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Expected: every command exits 0 with no test failures or lint errors.

- [ ] **Step 6: Run CLI help smoke checks**

Run:

```bash
pnpm dev generate video --help
pnpm dev artifact get-prompt --help
```

Expected: video help lists `short`, `--style`, and `--style-prompt`;
artifact help shows the new get-prompt usage.

- [ ] **Step 7: Review the final diff**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD
git diff HEAD -- src tests README.md CLAUDE.md package.json pnpm-lock.yaml
```

Expected: no whitespace errors, no unrelated files, no credentials, and no
generated `dist/` artifacts.

- [ ] **Step 8: Commit release metadata and docs**

```bash
git add README.md CLAUDE.md package.json pnpm-lock.yaml
git commit -m "chore(release): prepare v0.1.3"
```

If `pnpm-lock.yaml` has no diff, omit it from `git add`.

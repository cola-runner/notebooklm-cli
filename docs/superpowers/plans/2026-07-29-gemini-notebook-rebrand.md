# Gemini Notebook Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the project completely from NotebookLM CLI to Gemini Notebook CLI and publish the breaking `0.2.0` release under the new GitHub and npm names.

**Architecture:** Treat `package.json` as the package/version source of truth and rename every project-owned public interface in one commit series on `main`. Preserve only accurate Google backend hostnames, generic notebook domain terms, upstream `notebooklm-py` references, and historical documents. Perform all local verification before renaming or publishing external resources.

**Tech Stack:** TypeScript, Node.js 20+, Commander, Vitest, pnpm, npm registry, GitHub CLI.

## Global Constraints

- Execute directly on `main`; do not create a worktree or compatibility branch.
- New package: `@cola_runner/gemini-notebook-cli` version `0.2.0`.
- New executable: `gemini-notebook`.
- New SDK client: `GeminiNotebookClient`.
- New environment prefix: `GEMINI_NOTEBOOK_`.
- New configuration root: `~/.config/gemini-notebook-cli`.
- Do not export or accept old aliases.
- Do not migrate the old configuration directory.
- Preserve `notebooklm.google.com`, `notebook.google.com`, and real `notebooklm-py` names.
- Do not rewrite historical files under `docs/superpowers/specs/` or `docs/superpowers/plans/`, except this plan and its paired design.

---

### Task 1: Rename the Package, Executable, and SDK

**Files:**
- Create: `tests/unit/rebrand.test.ts`
- Modify: `package.json`
- Modify: `src/client.ts`
- Modify: `src/index.ts`
- Modify: `src/cli/index.ts`
- Modify: `src/cli/helpers.ts`
- Modify: `src/cli/loginShared.ts`

**Interfaces:**
- Produces: npm package `@cola_runner/gemini-notebook-cli@0.2.0`.
- Produces: executable mapping `{ "gemini-notebook": "./dist/cli/index.js" }`.
- Produces: exported class `GeminiNotebookClient`.
- Removes: `NotebookLMClient` export and `notebooklm` executable.

- [ ] **Step 1: Write failing public-contract tests**

Create `tests/unit/rebrand.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as publicApi from '../../src/index.js';
import { GeminiNotebookClient } from '../../src/client.js';

describe('Gemini Notebook public identity', () => {
  it('publishes only the renamed package and executable', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      name: string;
      version: string;
      bin: Record<string, string>;
    };
    expect(pkg.name).toBe('@cola_runner/gemini-notebook-cli');
    expect(pkg.version).toBe('0.2.0');
    expect(pkg.bin).toEqual({ 'gemini-notebook': './dist/cli/index.js' });
  });

  it('exports only the renamed SDK client', () => {
    expect(publicApi.GeminiNotebookClient).toBe(GeminiNotebookClient);
    expect('NotebookLMClient' in publicApi).toBe(false);
  });
});
```

- [ ] **Step 2: Run the contract tests and verify RED**

Run:

```bash
pnpm vitest run tests/unit/rebrand.test.ts
```

Expected: FAIL because the new package, executable, and SDK class do not exist.

- [ ] **Step 3: Apply the public rename**

In `package.json`, set:

```json
{
  "name": "@cola_runner/gemini-notebook-cli",
  "version": "0.2.0",
  "description": "Agent-first unofficial Gemini Notebook client for Node.js — JSON CLI, citations, multi-turn chat, all studio artifacts, research & notes",
  "bin": {
    "gemini-notebook": "./dist/cli/index.js"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/cola-runner/gemini-notebook-cli.git"
  }
}
```

Rename the class and all current source imports:

```ts
export class GeminiNotebookClient {
  static async fromStorage(opts: ClientOptions = {}): Promise<GeminiNotebookClient>
  static fromState(state: StorageState, opts: ClientOptions = {}): GeminiNotebookClient
}
```

Change `src/index.ts` to:

```ts
export { GeminiNotebookClient, type ClientOptions } from './client.js';
```

Change the Commander identity in `src/cli/index.ts` to:

```ts
program
  .name('gemini-notebook')
  .description('Unofficial Gemini Notebook CLI for Node.js')
  .version(packageJson.version);
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm vitest run tests/unit/rebrand.test.ts tests/unit/cliVersion.test.ts
pnpm typecheck
```

Expected: both test files pass and TypeScript exits zero.

- [ ] **Step 5: Commit the public rename**

```bash
git add package.json src/client.ts src/index.ts src/cli/index.ts src/cli/helpers.ts src/cli/loginShared.ts tests/unit/rebrand.test.ts
git commit -m "feat!: rename public API to Gemini Notebook"
```

---

### Task 2: Rename Runtime Configuration and User-Facing Output

**Files:**
- Modify: `src/env.ts`
- Modify: `src/auth/paths.ts`
- Modify: `src/session/transport.ts`
- Modify: `src/rpc/decoder.ts`
- Modify: `src/rpc/errors.ts`
- Modify: `src/rpc/overrides.ts`
- Modify: `src/rpc/safeIndex.ts`
- Modify: `src/rpc/types.ts`
- Modify: `src/api/user.ts`
- Modify: `src/auth/extraction.ts`
- Modify: `src/cli/index.ts`
- Modify: `src/cli/loginBrowser.ts`
- Modify: `src/cli/loginPaste.ts`
- Modify: `src/cli/loginShared.ts`
- Modify: `src/cli/output.ts`
- Modify: `tests/unit/rebrand.test.ts`
- Modify: `tests/unit/sourceUpload.test.ts`
- Modify: `tests/unit/userTier.test.ts`
- Modify: `tests/unit/userOutput.test.ts`

**Interfaces:**
- Produces: `GEMINI_NOTEBOOK_BASE_URL`, `GEMINI_NOTEBOOK_HL`,
  `GEMINI_NOTEBOOK_STORAGE`, `GEMINI_NOTEBOOK_REFRESH_CMD`,
  `GEMINI_NOTEBOOK_DISABLE_KEEPALIVE_POKE`, `GEMINI_NOTEBOOK_DEBUG`,
  `GEMINI_NOTEBOOK_STRICT_DECODE`, and `GEMINI_NOTEBOOK_RPC_OVERRIDES`.
- Produces: default storage path ending in
  `.config/gemini-notebook-cli/storage_state.json`.
- Removes: all reads of project-owned `NOTEBOOKLM_*` variables.

- [ ] **Step 1: Extend failing runtime-contract tests**

Add to `tests/unit/rebrand.test.ts`:

```ts
import {
  DISABLE_KEEPALIVE_ENV_VAR,
  REFRESH_CMD_ENV_VAR,
  STORAGE_ENV_VAR,
  defaultStoragePath,
} from '../../src/auth/paths.js';
import { RPC_OVERRIDES_ENV_VAR } from '../../src/rpc/overrides.js';

it('uses only the Gemini Notebook runtime namespace', () => {
  expect(defaultStoragePath()).toMatch(
    /[.]config[/\\]gemini-notebook-cli[/\\]storage_state[.]json$/,
  );
  expect(STORAGE_ENV_VAR).toBe('GEMINI_NOTEBOOK_STORAGE');
  expect(REFRESH_CMD_ENV_VAR).toBe('GEMINI_NOTEBOOK_REFRESH_CMD');
  expect(DISABLE_KEEPALIVE_ENV_VAR).toBe('GEMINI_NOTEBOOK_DISABLE_KEEPALIVE_POKE');
  expect(RPC_OVERRIDES_ENV_VAR).toBe('GEMINI_NOTEBOOK_RPC_OVERRIDES');
});
```

Update existing tests to use `GEMINI_NOTEBOOK_BASE_URL` and tier values such
as `GEMINI_NOTEBOOK_TIER_PRO`.

- [ ] **Step 2: Run the runtime tests and verify RED**

Run:

```bash
pnpm vitest run tests/unit/rebrand.test.ts tests/unit/sourceUpload.test.ts tests/unit/userTier.test.ts tests/unit/userOutput.test.ts
```

Expected: FAIL on the legacy configuration directory, environment names, and
tier strings.

- [ ] **Step 3: Rename environment, storage, tier, and command strings**

Apply exact replacements in current source and tests:

```text
NOTEBOOKLM_BASE_URL                 → GEMINI_NOTEBOOK_BASE_URL
NOTEBOOKLM_HL                       → GEMINI_NOTEBOOK_HL
NOTEBOOKLM_STORAGE                  → GEMINI_NOTEBOOK_STORAGE
NOTEBOOKLM_REFRESH_CMD              → GEMINI_NOTEBOOK_REFRESH_CMD
NOTEBOOKLM_DISABLE_KEEPALIVE_POKE   → GEMINI_NOTEBOOK_DISABLE_KEEPALIVE_POKE
NOTEBOOKLM_DEBUG                    → GEMINI_NOTEBOOK_DEBUG
NOTEBOOKLM_STRICT_DECODE            → GEMINI_NOTEBOOK_STRICT_DECODE
NOTEBOOKLM_RPC_OVERRIDES            → GEMINI_NOTEBOOK_RPC_OVERRIDES
NOTEBOOKLM_TIER_                    → GEMINI_NOTEBOOK_TIER_
.config/notebooklm-cli             → .config/gemini-notebook-cli
notebooklm login                    → gemini-notebook login
notebooklm import-chrome            → gemini-notebook import-chrome
notebooklm list                     → gemini-notebook list
[notebooklm-cli]                    → [gemini-notebook-cli]
```

Do not alter `notebooklm.google.com`, `notebook.google.com`, or
`notebooklm-py`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm vitest run tests/unit/rebrand.test.ts tests/unit/sourceUpload.test.ts tests/unit/userTier.test.ts tests/unit/userOutput.test.ts
pnpm typecheck
pnpm lint
```

Expected: all selected tests and checks pass.

- [ ] **Step 5: Commit the runtime rename**

```bash
git add src tests/unit
git commit -m "feat!: move runtime state to Gemini Notebook namespace"
```

---

### Task 3: Rebrand Current Documentation and Add a Guardrail

**Files:**
- Create: `tests/unit/brandGuard.test.ts`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `.gitignore`

**Interfaces:**
- Produces: current user and contributor documentation containing only the new
  project-owned brand.
- Preserves: `notebooklm.google.com`, `notebook.google.com`, and
  `notebooklm-py` references.

- [ ] **Step 1: Write a failing brand guard**

Create `tests/unit/brandGuard.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const currentFiles = ['README.md', 'CLAUDE.md', '.gitignore'];
const forbidden = [
  '@cola_runner/notebooklm-cli',
  'NotebookLMClient',
  'NOTEBOOKLM_',
  '~/.config/notebooklm-cli',
  'notebooklm login',
  'notebooklm list',
];

describe('current branding', () => {
  for (const file of currentFiles) {
    it(`${file} has no retired project-owned identifiers`, () => {
      const text = readFileSync(file, 'utf8');
      for (const value of forbidden) expect(text).not.toContain(value);
    });
  }
});
```

The guard intentionally does not forbid Google backend hosts or
`notebooklm-py`.

- [ ] **Step 2: Run the brand guard and verify RED**

Run:

```bash
pnpm vitest run tests/unit/brandGuard.test.ts
```

Expected: FAIL on README and contributor-document legacy identifiers.

- [ ] **Step 3: Rewrite current documentation**

Update:

- project heading and description to Gemini Notebook CLI;
- npm badge and installation package to
  `@cola_runner/gemini-notebook-cli`;
- every current command example to `gemini-notebook`;
- SDK imports and examples to `GeminiNotebookClient`;
- environment variable documentation to `GEMINI_NOTEBOOK_*`;
- configuration paths to `.config/gemini-notebook-cli`;
- release heading to `v0.2.0`;
- test count to include the new contract and guard tests;
- repository clone URL to
  `https://github.com/cola-runner/gemini-notebook-cli.git`.

Keep the historical explanation that the product was formerly NotebookLM and
retain accurate upstream/backend references.

- [ ] **Step 4: Verify GREEN and audit source**

Run:

```bash
pnpm vitest run tests/unit/brandGuard.test.ts
rg -n "@cola_runner/notebooklm-cli|\\bNotebookLMClient\\b|NOTEBOOKLM_|[.]config/notebooklm-cli|\\bnotebooklm (login|list|status|whoami|create|source|label|ask|note|share|research|generate|artifact|download|import-chrome)" src tests README.md CLAUDE.md .gitignore package.json
```

Expected: the test passes and `rg` returns no matches.

- [ ] **Step 5: Commit documentation and guardrail**

```bash
git add README.md CLAUDE.md .gitignore tests/unit/brandGuard.test.ts
git commit -m "docs: rebrand project as Gemini Notebook CLI"
```

---

### Task 4: Verify and Package 0.2.0

**Files:**
- Modify only if a verification failure identifies a specific defect.

**Interfaces:**
- Produces: a clean, publishable
  `@cola_runner/gemini-notebook-cli@0.2.0` tarball.

- [ ] **Step 1: Run complete verification**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
git diff --check
node dist/cli/index.js --version
npm pack --dry-run --json
```

Expected: all commands exit zero; the CLI reports `0.2.0`; the dry run reports
`@cola_runner/gemini-notebook-cli@0.2.0`.

- [ ] **Step 2: Smoke-test the packed public interface**

In a fresh temporary directory, install the generated package and run:

```bash
gemini-notebook --version
node --input-type=module -e "import { GeminiNotebookClient } from '@cola_runner/gemini-notebook-cli'; console.log(typeof GeminiNotebookClient)"
```

Expected output:

```text
0.2.0
function
```

- [ ] **Step 3: Verify repository state**

```bash
git status --short --branch
git log --oneline origin/main..HEAD
```

Expected: clean `main` containing only the approved rebrand commits ahead of
`origin/main`.

---

### Task 5: Rename and Release Externally

**Files:**
- No local source edits expected.

**Interfaces:**
- Produces: GitHub repository
  `https://github.com/cola-runner/gemini-notebook-cli`.
- Produces: npm package
  `@cola_runner/gemini-notebook-cli@0.2.0`.
- Produces: GitHub Latest Release `v0.2.0`.
- Deprecates: every published version of
  `@cola_runner/notebooklm-cli`.

- [ ] **Step 1: Rename the GitHub repository**

```bash
gh api --method PATCH repos/cola-runner/notebooklm-cli -f name=gemini-notebook-cli
git remote set-url origin https://github.com/cola-runner/gemini-notebook-cli.git
git remote -v
```

Expected: GitHub returns `"name": "gemini-notebook-cli"` and both local origin
URLs use the new repository.

- [ ] **Step 2: Push code and release tag**

```bash
git push origin main
git tag -a v0.2.0 -m "v0.2.0"
git push origin v0.2.0
```

Expected: both pushes succeed without force.

- [ ] **Step 3: Publish the new npm package**

```bash
npm whoami
pnpm publish --access public
```

Expected: npm identifies `cola_runner` and publishes
`@cola_runner/gemini-notebook-cli@0.2.0`.

- [ ] **Step 4: Create GitHub Release**

```bash
gh release create v0.2.0 \
  --repo cola-runner/gemini-notebook-cli \
  --verify-tag \
  --latest \
  --title "v0.2.0 — Gemini Notebook rebrand" \
  --generate-notes
```

Expected: GitHub returns the new Release URL.

- [ ] **Step 5: Deprecate the old npm package**

```bash
npm deprecate '@cola_runner/notebooklm-cli@*' "Renamed to @cola_runner/gemini-notebook-cli; install the new package."
```

Expected: every legacy version carries the migration message.

- [ ] **Step 6: Verify all external surfaces**

```bash
npm view @cola_runner/gemini-notebook-cli version dist-tags --json
npm view @cola_runner/notebooklm-cli versions deprecated --json
gh api repos/cola-runner/gemini-notebook-cli --jq '{full_name,default_branch,html_url}'
gh api repos/cola-runner/gemini-notebook-cli/releases/latest --jq '{tag_name,name,draft,prerelease,html_url}'
git status --short --branch
```

Expected:

- new npm `latest` is `0.2.0`;
- old npm package is deprecated with the migration message;
- GitHub repository is renamed and defaults to `main`;
- GitHub Latest Release is `v0.2.0`;
- local `main` is synchronized with `origin/main`.

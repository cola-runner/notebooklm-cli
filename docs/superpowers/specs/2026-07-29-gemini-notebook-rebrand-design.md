# Gemini Notebook Rebrand Design

**Date:** 2026-07-29  
**Status:** Approved  
**Release:** 0.2.0

## Context

Google renamed NotebookLM to Gemini Notebook on 2026-07-16. This project will
perform a complete, intentionally breaking rebrand rather than maintain legacy
aliases. The existing repository will be renamed in place so its Git history,
tags, and releases remain available.

## Goals

- Rename every project-owned public brand identifier to Gemini Notebook.
- Publish the renamed package as `@cola_runner/gemini-notebook-cli@0.2.0`.
- Expose the `gemini-notebook` executable and `GeminiNotebookClient` SDK class.
- Move project-owned environment variables and persisted authentication to the
  new namespace.
- Rename the GitHub repository to `cola-runner/gemini-notebook-cli`.
- Deprecate the complete legacy npm package and direct users to the new package.

## Non-goals

- No compatibility aliases for the old package, executable, SDK class,
  environment variables, or configuration directory.
- No automatic migration of legacy authentication state.
- No changes to Google-owned backend hostnames that still contain
  `notebooklm`.
- No rewriting of the upstream project's real name, `notebooklm-py`.
- No rewriting of historical plans, specifications, tags, or release notes.

## Public Naming

| Surface | New value |
|---|---|
| Project/repository | `gemini-notebook-cli` |
| npm package | `@cola_runner/gemini-notebook-cli` |
| CLI executable | `gemini-notebook` |
| SDK client | `GeminiNotebookClient` |
| Environment prefix | `GEMINI_NOTEBOOK_` |
| Configuration directory | `~/.config/gemini-notebook-cli` |
| Release version | `0.2.0` |

Generic domain terms such as `Notebook`, `notebookId`, and `notebooks` remain
unchanged because they describe the product's data model rather than the former
brand.

## Code and Data Changes

- `package.json` becomes the single source of truth for the new package name and
  version.
- The CLI continues to read its version from package metadata and changes its
  Commander name, user-facing descriptions, hints, and examples.
- The SDK export and implementation class become `GeminiNotebookClient`.
- Project-owned log prefixes change to `gemini-notebook-cli`.
- `NOTEBOOKLM_BASE_URL`, `NOTEBOOKLM_DEBUG`, and related project-owned variables
  become `GEMINI_NOTEBOOK_*`.
- Authentication defaults to
  `~/.config/gemini-notebook-cli/storage_state.json`. The old directory is not
  read or migrated.
- Google-owned URLs, response fields, cookies, and RPC behavior remain intact.

## Documentation

README installation, examples, badges, imports, headings, and product language
will use Gemini Notebook. Contributor documentation will describe the renamed
CLI and SDK while retaining accurate references to `notebooklm-py` and legacy
Google endpoints.

## Verification

Automated tests will protect these breaking contracts:

- package name and version are the expected 0.2.0 release values;
- CLI `--version` matches `package.json`;
- the executable is named `gemini-notebook`;
- only `GeminiNotebookClient` is exported;
- configuration and environment lookup use only the new namespace;
- old project-owned public identifiers are absent outside explicitly allowlisted
  historical and upstream/backend references.

The full test suite, type check, lint, build, package dry run, clean-install CLI
smoke test, and registry/repository state checks must pass before completion.

## Release Sequence

1. Apply and verify the complete local rebrand on `main`.
2. Commit the 0.2.0 code and documentation.
3. Rename the GitHub repository in place.
4. update the local `origin` URL and push `main`.
5. Create and push tag `v0.2.0`.
6. Publish `@cola_runner/gemini-notebook-cli@0.2.0`.
7. Create the `v0.2.0` GitHub Release and mark it Latest.
8. Deprecate all versions of `@cola_runner/notebooklm-cli` with a migration
   message pointing to the new package.
9. Verify GitHub, npm, and a clean installed CLI all report 0.2.0.

If an external release step fails, do not repeat already-successful immutable
operations. Inspect remote state and resume from the first incomplete step.

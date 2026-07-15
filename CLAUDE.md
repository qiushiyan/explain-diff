# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`explain-diff` turns a branch's changes into a served, interactive explainer: a model-authored literate walkthrough with real diff hunks spliced in, a quiz whose transcript flows back to the coding agent, and a full-diff appendix. A Claude Code skill (`skills/explain-diff/SKILL.md`, Skills-CLI-compatible layout) drives the CLI; the CLI owns everything deterministic so the model authors only prose (`walkthrough.md`) and questions (`quiz.yaml`).

## Commands

```sh
pnpm build            # build:cli (tsc → dist/cli) + build:viewer (vite → dist/viewer)
pnpm build:cli        # CLI only — fast, most edits live here
pnpm build:viewer     # viewer only
pnpm typecheck        # both tsconfigs (tsconfig.cli.json, tsconfig.viewer.json)
pnpm dev:viewer       # vite dev server; proxies /api and /figures to a running
                      # `explain-diff open <session>` on port 4747
```

- The global `explain-diff` bin is installed via `pnpm add -g link:` — it symlinks this checkout, so `pnpm build` propagates immediately.
- Running `open` servers read `dist/viewer` from disk **per request**: rebuilding the viewer updates already-open sessions on refresh, no restart.
- There are no tests (deliberate for v1). Verify with a fixture repo: create a throwaway git repo with a branch containing modify/rename/binary/untracked changes, then run `explain-diff new --repo <dir>`, author the session files, `check`, `open --no-open`, and curl `/api/payload`. For rendering, use `playwright-core` (devDependency) with the cached headless shell at `~/Library/Caches/ms-playwright/chromium_headless_shell-*/`; wait for `load`, never `networkidle` (the SSE stream keeps the connection open forever).

CLI exit codes: `0` ok · `1` error/invalid · `3` transcript not yet submitted (`answers` poll semantics).

## Architecture

Full design rationale — intention, flows, invariants, and the alternatives each decision beat — lives in `docs/architecture.md`; `docs/README.md` maps the docs. Condensed model:

Two build targets, one seam. `src/shared/payload.ts` is the only type contract that crosses it (`SessionPayload` out, `Transcript` back); the viewer renders payloads without validating anything.

**A session is pure data**, stored globally, never in the target repo:

```
~/.local/share/explain-diff/<repo-slug>/<date>-<branch>/
  manifest.json    written by `new` — trusted
  changes.patch    captured diff — source of truth for all code shown
  files.json       per-file summaries from git (rename/binary detection)
  walkthrough.md   model-authored — untrusted until compiled
  quiz.yaml        model-authored — untrusted until compiled
  figures/         optional interactive HTML, iframed sandboxed
  transcript.json  written by the server on quiz submit
```

`repo-slug` derives from `git rev-parse --git-common-dir`, so all worktrees of a repo share one archive.

**`src/cli/` — few deep modules, no ports/DI** (dependencies are git + fs; a `GitPort` would be a single-adapter seam, i.e. indirection). Commands in `main.ts` are thin compositions:

- `change.ts` — everything git: base detection (`origin/HEAD` → probe `main/master/develop/trunk` → `--base`), then merge-base → **working tree** capture, uncommitted and untracked included (untracked via `git diff --no-index /dev/null <rel>`; its exit 1 is success, and `git()`'s `allowFailure` returns the error's stdout for exactly this reason).
- `compile.ts` — the **single validation boundary** (parse, don't validate). Parses walkthrough directives (`:::hunk path#L10-L40`, `:::figure`), resolves hunks against the captured patch by hand-parsing `@@` headers (`@pierre/diffs` is deliberately viewer-only), and shuffles quiz options with a session-seeded PRNG that balances correct-answer positions — authors cannot express a biased position. `check` and `open` are both callers of `compileSession()`. Errors carry file:line and list valid alternatives so the model can self-correct.
- `session.ts` — the store, session-dir scaffolding, and atomic transcript I/O. The scaffolded `walkthrough.md`/`quiz.yaml` templates are the **single source of truth for authoring syntax**; the skill intentionally doesn't restate it. Changing directive syntax or the quiz schema means updating these templates *and* `compile.ts` together.
- `serve.ts` — node:http, no framework. Serves `dist/viewer` + session data, watches the session dir, recompiles and pings SSE on change (agents revise the walkthrough mid-conversation; the open page live-reloads). **The answer channel is the filesystem**: the server writes `transcript.json` atomically; `answers` polls the file and never talks to the server.

**`src/viewer/`** — React 19 + `@pierre/diffs/react` (diff rendering) + `@pierre/trees/react` (appendix file tree), built once at package build time; sessions never trigger builds. The walkthrough is a compiled block list (`prose` html | `hunk` patch-slice | `figure` iframe src). Quiz MCQs grade instantly in-page and lock on first pick; free-text is graded by the agent. The appendix is responsive: ≥1100px gets a sticky tree navigator (virtualized — it renders zero rows without an explicit container height) beside split-view diffs; below that, stacked unified `<details>`. Quiz state must survive SSE payload refetches (keyed by question id; shuffle is seeded so reloads don't reorder options mid-quiz).

## Conventions

- Design vocabulary follows deep-modules thinking: schemas live inside the module that parses them; a new seam needs two real adapters to earn a port; `check`-style validation belongs in `compile.ts`, not scattered.
- `tsconfig` strictness includes `exactOptionalPropertyTypes` — optional payload fields are spread conditionally (`...(x !== undefined ? { x } : {})`), keep that pattern.
- CLI imports use `.js` extensions (nodenext); viewer imports are extensionless (bundler) with `@shared/*` aliased in both `vite.config.ts` and `tsconfig.viewer.json`.
- stdout is for machine-readable JSON (the consumer is usually an agent); diagnostics go to stderr.
- `resources/` (reference copies of Geoffrey Litt's explain-diff post/skill) is gitignored; the repo is private partly because of those copies — replace with links before making it public.

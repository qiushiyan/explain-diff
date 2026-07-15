# Architecture

## One seam, two build targets

The system is a CLI (Node) and a viewer (React), built separately into `dist/`. Exactly one type contract crosses between them — `src/shared/payload.ts`:

```
SessionPayload  →   (CLI compiles, viewer renders — no validation viewer-side)
Transcript      ←   (viewer submits, CLI reads — the reader's answers)
```

The viewer is built **once at package build time**; a session never triggers a build. Sessions are pure data.

## A session is a directory

```
~/.local/share/explain-diff/<repo-slug>/<date>-<branch>/
  manifest.json    # trusted — written by `new`
  changes.patch    # the captured diff; source of truth for all code shown
  files.json       # per-file summaries from git (rename/binary detection)
  walkthrough.md   # model-authored — untrusted until compiled
  quiz.yaml        # model-authored — untrusted until compiled
  figures/         # optional interactive HTML, iframed sandboxed
  transcript.json  # written by the server when the reader submits
```

Everything is human-readable without the tool — that is the archive guarantee. The `repo-slug` derives from `git rev-parse --git-common-dir`, so every worktree of a repo shares one archive. Nothing is ever written into the target repository.

The scaffolded `walkthrough.md` and `quiz.yaml` templates (written by `new`, defined in `src/cli/session.ts`) are the **single source of truth for authoring syntax** — directives, quiz schema, figure rules. Docs and the skill point at them rather than restate them.

## Modules

Few deep modules; commands are thin compositions over them (`src/cli/main.ts`). There are no ports or dependency injection — the only dependencies are git and the filesystem, and a seam with a single adapter is indirection, not a seam.

```
src/cli/
  change.ts     # everything git: base detection, merge-base → working-tree capture
  session.ts    # the store: session dirs, scaffold templates, atomic transcript I/O
  compile.ts    # the single validation boundary; deepest module
  serve.ts      # node:http + SSE live-reload + transcript intake
  main.ts       # terminal adapter: JSON on stdout, diagnostics on stderr
src/viewer/     # walkthrough blocks · quiz · appendix (tree + split diffs)
src/shared/
  payload.ts    # the contract
skills/
  explain-diff/ # the Claude Code skill; authors judgment, defers syntax to the templates
```

### Flows

```
new:      git → captureChange → createSession → session dir + JSON summary (for the agent)
check:    compileSession → errors (file:line, with valid alternatives) | ok summary
open:     compileSession → serve(dist/viewer + payload) → fs.watch → recompile → SSE ping
answers:  poll transcript.json → merge with compiled quiz → transcript JSON for the agent
```

`check` and `open` are two callers of the same `compileSession()` — validation logic exists exactly once.

## Load-bearing invariants

- **Parse, don't validate — once.** Model-authored files are untrusted input, parsed at `compile.ts` into a typed `SessionPayload`. The viewer renders without checking anything.
- **Displayed code cannot drift.** `:::hunk` directives resolve against `changes.patch`; the compiler slices real patch text. A hunk reference that doesn't match the change is a compile error, not a silent fallback.
- **Quiz bias is unrepresentable.** Authors mark the correct option; display positions are assigned at compile time by a session-seeded shuffle that balances correct-answer positions across questions. Seeding means SSE reloads never reshuffle mid-quiz.
- **The answer channel is the filesystem.** The server writes `transcript.json` atomically; `answers` polls the file and never talks to the server. Either process can die without breaking the other, and the transcript is automatically part of the archive.
- **Agent-agnostic plumbing.** The CLI speaks JSON on stdout and exit codes (`0` ok · `1` invalid · `3` transcript pending) — any terminal agent can drive it; only the skill is Claude-specific.

## Decisions, and the alternatives they beat

- **Compiler CLI + prebuilt viewer** over model-hand-authored HTML (the original Litt skill) and over MDX. Hand-authored HTML spends thousands of tokens on boilerplate, re-types code that can drift, and enforces quiz fairness by prompt-pleading; MDX would force a per-session build. Markdown-with-directives compiled to a structured block list keeps the model writing what it's good at (prose) and the viewer a dumb block renderer.
- **Hybrid quiz grading.** MCQs grade instantly in-page (tight feedback, works offline); the full transcript — including a free-text question only the agent can grade — flows back to the terminal for the debrief. Alternatives: fully in-page (no remediation loop) or fully agent-graded (slow per-question feedback).
- **Literate document with an appendix**, not a dashboard. The primary surface is prose that pulls real hunks into itself; the full diff is demoted to an appendix (file-tree navigator + side-by-side on wide screens, stacked unified below). All files stay stacked with the tree as navigator — master-detail was considered and rejected to preserve the read-through review flow.
- **`@pierre/diffs` is viewer-only.** The CLI hand-parses `@@` hunk headers for directive resolution — a fully specified format — keeping the rendering library out of the CLI's dependency surface.
- **Global store over a repo dot-folder.** Worktrees share an archive, nothing pollutes the target repo, and no gitignore choreography is needed.

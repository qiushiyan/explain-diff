# explain-diff

Literate diff explainers with quizzes, built for terminal coding agents.

Your agent wrote the branch; you supervised without reading every line. At the end of the session, type `/explain-diff` and get a served, interactive page that catches you up: a **literate walkthrough** of the change (prose in concept order, with real diff hunks spliced in — never retyped by the model), a **quiz** that checks your understanding before the change ships, and a **full-diff appendix** with a file-tree navigator and side-by-side view. Your quiz answers flow back to the agent in the terminal, which grades the free-text question and debriefs any misconception it finds.

Inspired by Geoffrey Litt's [Understanding is the new bottleneck](https://www.geoffreylitt.com/2026/07/02/understanding-is-the-new-bottleneck.html) and his [explain-diff skill](https://gist.github.com/geoffreylitt/a29df1b5f9865506e8952488eac3d524) — rebuilt so that everything deterministic (diff capture, hunk rendering, quiz shuffling, serving, the answer channel) is owned by a CLI, and the model authors only prose and questions.

## Install

The CLI (requires Node ≥ 20 and git):

```sh
pnpm add -g explain-diff   # or: npm install -g explain-diff
```

The agent skill, via the [Skills CLI](https://github.com/vercel-labs/skills):

```sh
npx skills add qiushiyan/explain-diff
```

Add `-g` to install the skill user-globally, or `--agent claude-code` to target a specific agent.

## Use

When you're wrapping up a coding-agent session — the feature works, the bug is fixed, you're about to open the PR — type:

```
/explain-diff
```

Then:

1. **The agent prepares the explainer.** It captures the branch's diff against its base (auto-detected: `origin/HEAD`, then `main`/`master`/`develop`/`trunk`; pass a ref to override, e.g. `/explain-diff develop`), studies the change, writes the walkthrough and quiz, and hands you a `localhost` URL. Uncommitted work is included — you don't need to commit first.
2. **You read and take the quiz in the browser.** Multiple-choice questions grade instantly; answer everything and hit *Send answers to your agent*.
3. **You debrief in the terminal.** The agent receives your transcript, grades the free-text answer, and walks through anything you missed until the mental model sticks.

Sessions are archived under `~/.local/share/explain-diff/<repo>/` — nothing is written into your repository, and you can re-serve any past session later with `explain-diff open <session-dir>` (your recorded answers included) when you need to trace back through an old change.

The CLI also works standalone:

```sh
explain-diff new [--base <ref>]     # capture the change, scaffold a session
explain-diff check <session>        # validate walkthrough + quiz, machine-readable errors
explain-diff open <session>         # serve the viewer, open the browser
explain-diff answers <session>      # read the quiz transcript (exit 3 while pending)
```

## How it works

Design docs live in [`docs/`](docs/README.md). The short version: a session is a directory of pure data (captured patch + model-authored `walkthrough.md` and `quiz.yaml`); a compiler validates it into a payload; a prebuilt React viewer ([@pierre/diffs](https://diffs.com), [@pierre/trees](https://trees.software)) renders it; the quiz transcript returns to the agent through the filesystem.

## License

MIT

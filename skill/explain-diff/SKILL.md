---
name: explain-diff
description: Turn the current branch's changes into a literate walkthrough with a quiz, served in the browser; then debrief the reader's answers in the terminal.
disable-model-invocation: true
argument-hint: "[base ref, e.g. develop]"
---

# Explain Diff

The reader supervised this change but has not read it line by line. Catch them up to full creative participant: produce a **literate walkthrough** — the change explained as prose in concept order, with real hunks spliced in where the narrative needs them — capped by a quiz that acts as a **speed regulator** before the change ships, and a **debrief** of the answers.

The `explain-diff` CLI owns everything deterministic: diff capture, hunk rendering, option shuffling, serving, the answer channel. You author exactly two files of prose and questions; every line of code the reader sees is sliced from the captured patch.

## 1 · Capture

Run `explain-diff new` (add `--base <ref>` when the reader names one). Parse the JSON: the session directory, the changed files, the authoring paths.

Memory of writing this code supplies intent; `changes.patch` supplies facts. Verify every claim you are about to make against the patch.

## 2 · Investigate

Read `changes.patch` in full, then the surrounding system: the touched code paths, their callers, tests, prior behavior. Trace the old path and the new path far enough to explain behavior, not edits.

Done when you can state, one sentence each: the constraint that motivated the change · how the system behaved before · the smallest mental model of the new behavior · its observable consequences and edge cases.

## 3 · Author the walkthrough

Overwrite the scaffolded `walkthrough.md` (directive syntax is documented inside it). Structure:

- **Background** — only the pre-existing system this change touches: components, contracts, prior behavior.
- **Intuition** — the goal and core idea on toy inputs before any implementation; show old versus new behavior when the contrast sharpens it.
- **Code** — the change in concept and execution order. Splice a `:::hunk` exactly where the prose needs it; the appendix already carries the full diff.

Write in Martin Kleppmann's register: plain, flowing, precise about systems, jargon explained at first use.

Reach for a `:::figure` when intuition needs manipulation rather than prose — a **micro-world** with toy data the reader can poke. A figure is one self-contained HTML file in `figures/`; it runs in a sandboxed iframe (scripts only, no network, no external assets).

## 4 · Author the quiz

Overwrite the scaffolded `quiz.yaml` (schema documented inside it): five questions — four `mcq`, one `free`.

- Ask about behavior, causality, contracts, edge cases, trade-offs — answerable from understanding, never from matching a phrase in the page.
- Every distractor is a **misconception** a hurried reader would actually hold, with an explanation of why it tempts and why it fails.
- Keep options comparable in length, grammar, specificity, and confidence.
- Author options in any order — the compiler assigns display positions.
- The `free` question asks the reader to explain one causal link of the change in their own words; you grade it in the debrief.

## 5 · Check, then open

Run `explain-diff check <session>` and fix what it reports until it exits 0.

Start `explain-diff open <session>` as a background task, then hand the reader the URL and ask them to read the walkthrough and submit the quiz.

## 6 · Debrief

Run `explain-diff answers <session> --wait 300`; exit code 3 means the reader is still answering — run it again.

With the transcript: grade the free answer against the walkthrough. For each miss, name the misconception behind the chosen option, re-explain from the walkthrough's material, then test the same point from a fresh angle until the reader restates it correctly.

When the debrief exposed a real gap, append an `## Addendum` to `walkthrough.md` capturing the corrected model — the open page live-reloads, and the archive keeps the full trace.

Done when every miss is resolved and the reader confirms they are done.

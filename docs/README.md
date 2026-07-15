# explain-diff

Agents write the code; the human supervising them stops reading it line by line. What the human loses is the *mental model* — the ability to participate in the next iteration, and to trace back months later when something breaks. explain-diff exists to route scarce human attention to the load-bearing part of a change: a literate walkthrough of the branch, a quiz that acts as a speed regulator before the change ships, and a debrief where the agent corrects the reader's actual misconceptions.

The division of labor is the core intention:

- **The CLI owns everything deterministic** — diff capture, hunk rendering, quiz shuffling, serving, the answer channel. Reliability lives in code.
- **The model authors only judgment** — prose (`walkthrough.md`) and questions (`quiz.yaml`). Every line of code the reader sees is sliced from the captured patch, never retyped by the model.

## The loop

```
/explain-diff (skill, in the agent session)
  → explain-diff new          # capture branch diff, scaffold a session
  → model writes walkthrough.md + quiz.yaml
  → explain-diff check        # machine-checkable errors until clean
  → explain-diff open         # literate page + quiz + full-diff appendix in browser
  → reader submits quiz
  → explain-diff answers      # transcript back to the agent
  → debrief in the terminal   # misses traced to misconceptions; addendum archived
```

Sessions accumulate in a global per-repo archive — the durable trace of "what changed and why", outside the target repository.

## Docs

```
docs/
  README.md          # this file — intention and map
  architecture.md    # the design: seam, session data model, modules, invariants, decisions
skills/
  explain-diff/      # the Claude Code skill that drives the CLI
```

## Status

v1 is working end-to-end: capture, compile, serve, quiz round-trip, debrief, responsive diff appendix (file-tree + split view). Deliberately absent: automated tests, `explain-diff list`, learned per-repo base-branch config. The repo is private while `resources/` holds reference copies of Geoffrey Litt's explain-diff writing (gitignored; replace with links before publishing).

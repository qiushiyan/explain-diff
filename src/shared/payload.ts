/**
 * The one type contract that crosses the CLI ↔ viewer seam.
 *
 * The CLI's compileSession() is the single validation boundary: everything in
 * a SessionPayload has already been parsed and validated (parse, don't
 * validate). The viewer renders it without checking anything.
 *
 * The Transcript flows the other way: viewer → server → transcript.json →
 * `explain-diff answers` → the agent.
 */

/** Written by `explain-diff new`; trusted (we wrote it). */
export interface Manifest {
  version: 1
  /** Absolute path of the worktree the change was captured from. */
  repoRoot: string
  /** Groups all worktrees of one repo in the store, e.g. "planlab-a1b2c3". */
  repoSlug: string
  branch: string
  /** The ref the change is explained against, e.g. "origin/develop". */
  baseRef: string
  mergeBase: string
  head: string
  /** Working tree had uncommitted changes at capture time. */
  dirty: boolean
  createdAt: string
}

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export interface FileSummary {
  path: string
  /** Present when status is "renamed". */
  prevPath?: string
  status: FileStatus
  binary: boolean
  additions: number
  deletions: number
}

/**
 * The compiled walkthrough: model-authored markdown broken into blocks.
 * Prose is pre-rendered to HTML at compile time; hunk blocks carry a
 * single-file patch slice cut from the *captured* patch, so displayed code
 * can never drift from the real change.
 */
export type Block =
  | { kind: 'prose'; html: string }
  | {
      kind: 'hunk'
      file: string
      patch: string
      caption?: string
      /** Patch-slice line count; the viewer auto-collapses long hunks. */
      lines: number
      /** Author override via `collapsed` / `open` directive flags. */
      collapsed?: boolean
    }
  | { kind: 'figure'; src: string; caption?: string; height?: number }

/** Walkthrough section headings, in document order, for the viewer's ToC. */
export interface TocEntry {
  id: string
  text: string
  /** 2 = section, 3 = subsection. */
  depth: 2 | 3
}

export interface QuizOption {
  id: string
  html: string
  /** Shown after answering; why this option is right/wrong. */
  explanationHtml?: string
}

/**
 * Options arrive pre-shuffled (session-seeded, positions balanced across
 * questions at compile time). Authored order is never displayed, so a biased
 * answer position is unrepresentable.
 */
export type QuizQuestion =
  | {
      kind: 'mcq'
      id: string
      promptHtml: string
      options: QuizOption[]
      correctOptionId: string
      explanationHtml?: string
    }
  | {
      /** Free-text; graded by the agent in the terminal, not in the page. */
      kind: 'free'
      id: string
      promptHtml: string
    }

export interface SessionPayload {
  manifest: Manifest
  /** First h1 of walkthrough.md, else branch name. */
  title: string
  walkthrough: Block[]
  toc: TocEntry[]
  quiz: QuizQuestion[]
  /** Per-file summaries for the appendix header and hunk-directive errors. */
  files: FileSummary[]
  /** The full captured patch, rendered as the appendix. */
  patch: string
}

export type TranscriptAnswer =
  | {
      questionId: string
      kind: 'mcq'
      selectedOptionId: string
      /** Plain text of the chosen option, for the agent's benefit. */
      selectedText: string
      correct: boolean
    }
  | { questionId: string; kind: 'free'; text: string }

export interface Transcript {
  version: 1
  submittedAt: string
  answers: TranscriptAnswer[]
}

/** SSE messages pushed by the server. */
export type ServerEvent =
  | { type: 'payload' } // session files changed; refetch /api/payload
  | { type: 'transcript' } // transcript received (viewer shows confirmation)

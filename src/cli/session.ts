/**
 * The session store: a session is a directory of pure data in the global
 * archive. Human-readable even if this tool disappears — that's the
 * traceability guarantee.
 *
 *   ~/.local/share/explain-diff/<repo-slug>/<date>-<branch>/
 *     manifest.json    written by `new`, trusted
 *     changes.patch    the captured diff (source of truth for all code shown)
 *     files.json       per-file summaries from git (rename/binary detection)
 *     walkthrough.md   model-authored, untrusted until compiled
 *     quiz.yaml        model-authored, untrusted until compiled
 *     figures/         optional model-authored interactive HTML, iframed
 *     transcript.json  written by the server when the reader submits the quiz
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { FileSummary, Manifest, Transcript } from '../shared/payload.js'
import type { CapturedChange } from './change.js'

export interface SessionPaths {
  dir: string
  manifest: string
  patch: string
  files: string
  walkthrough: string
  quiz: string
  figuresDir: string
  transcript: string
}

export function sessionPaths(dir: string): SessionPaths {
  return {
    dir,
    manifest: join(dir, 'manifest.json'),
    patch: join(dir, 'changes.patch'),
    files: join(dir, 'files.json'),
    walkthrough: join(dir, 'walkthrough.md'),
    quiz: join(dir, 'quiz.yaml'),
    figuresDir: join(dir, 'figures'),
    transcript: join(dir, 'transcript.json'),
  }
}

function storeRoot(): string {
  const xdg = process.env['XDG_DATA_HOME']
  return join(xdg && xdg.trim() ? xdg : join(homedir(), '.local', 'share'), 'explain-diff')
}

function slugify(name: string): string {
  return name.toLowerCase().replaceAll(/[^a-z0-9._-]+/g, '-').replaceAll(/^-+|-+$/g, '') || 'session'
}

const WALKTHROUGH_TEMPLATE = `# <!-- title of the change -->

<!--
Literate walkthrough. Plain markdown, plus two directives on their own lines:

  :::hunk path/to/file.ts#L10-L40 "optional caption"
      Splices the real rendered hunks overlapping new-file lines 10-40.
      Omit #L10-L40 to include the file's whole diff.
      Long hunks auto-collapse in the page; force with a trailing
      \`collapsed\` or \`open\` flag.

  :::figure figures/name.html "optional caption" height=360
      Embeds an interactive HTML figure from this session's figures/ dir.

Structure: Background → Intuition → Code (grouped by concept, in execution
or dependency order — not file order). Prose first; hunks appear where the
narrative needs them. Run \`explain-diff check <session>\` to validate.
-->
`

const QUIZ_TEMPLATE = `# Five medium-difficulty questions about behavior, causality, contracts,
# edge cases, or trade-offs. Do NOT think about option order or balance —
# positions are shuffled and balanced mechanically at compile time.
#
# questions:
#   - kind: mcq
#     prompt: What happens when ... ?
#     options:
#       - text: The correct behavior
#         correct: true
#         explanation: Why this is right.
#       - text: A plausible misreading
#         explanation: The misconception this reflects.
#       - text: Another plausible distractor
#     explanation: Optional question-level explanation shown after answering.
#   - kind: free
#     prompt: In your own words, why did X have to change when Y ... ?
#       (free answers are graded by the agent in the terminal)
questions: []
`

/** Creates <store>/<repo-slug>/<date>-<branch>[-N] and scaffolds authoring files. */
export function createSession(capture: CapturedChange): SessionPaths {
  const date = capture.manifest.createdAt.slice(0, 10)
  const base = join(storeRoot(), capture.manifest.repoSlug, `${date}-${slugify(capture.manifest.branch)}`)
  let dir = base
  for (let n = 2; existsSync(dir); n++) dir = `${base}-${n}`

  const paths = sessionPaths(dir)
  mkdirSync(paths.figuresDir, { recursive: true })
  writeFileSync(paths.manifest, JSON.stringify(capture.manifest, null, 2))
  writeFileSync(paths.patch, capture.patch)
  writeFileSync(paths.files, JSON.stringify(capture.files, null, 2))
  writeFileSync(paths.walkthrough, WALKTHROUGH_TEMPLATE)
  writeFileSync(paths.quiz, QUIZ_TEMPLATE)
  return paths
}

/** Resolves a session directory argument; throws with a useful message. */
export function resolveSession(arg: string): SessionPaths {
  const dir = resolve(arg)
  const paths = sessionPaths(dir)
  if (!existsSync(paths.manifest)) {
    throw new Error(`${dir} is not a session directory (no manifest.json)`)
  }
  return paths
}

export function readManifest(paths: SessionPaths): Manifest {
  return JSON.parse(readFileSync(paths.manifest, 'utf8')) as Manifest
}

export function readFiles(paths: SessionPaths): FileSummary[] {
  return JSON.parse(readFileSync(paths.files, 'utf8')) as FileSummary[]
}

export function readTranscript(paths: SessionPaths): Transcript | null {
  if (!existsSync(paths.transcript)) return null
  return JSON.parse(readFileSync(paths.transcript, 'utf8')) as Transcript
}

/** Atomic write: the `answers` poller must never observe a torn file. */
export function writeTranscript(paths: SessionPaths, transcript: Transcript): void {
  const tmp = `${paths.transcript}.tmp`
  writeFileSync(tmp, JSON.stringify(transcript, null, 2))
  renameSync(tmp, paths.transcript)
}

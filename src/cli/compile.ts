/**
 * compileSession: the single validation boundary (parse, don't validate).
 *
 * Model-authored files (walkthrough.md, quiz.yaml, figures/) are untrusted
 * input; they are parsed here, once, into a SessionPayload the viewer renders
 * without checking. `check` and `open` are both callers of this interface.
 *
 * Hunk directives resolve against the *captured* patch, so displayed code can
 * never drift from the real change. Quiz option positions are assigned here —
 * session-seeded shuffle, correct answers balanced across questions — so a
 * biased position is unrepresentable by the author.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { marked, Marked } from 'marked'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import type { Block, QuizOption, QuizQuestion, SessionPayload, TocEntry } from '../shared/payload.js'
import { readFiles, readManifest, type SessionPaths } from './session.js'

export interface CompileError {
  file: string
  line?: number
  message: string
}

export type CompileResult =
  | { ok: true; payload: SessionPayload }
  | { ok: false; errors: CompileError[] }

// ---------------------------------------------------------------------------
// Patch slicing: raw text, informed only by @@ headers and diff --git breaks.

interface PatchHunk {
  /** New-side start/count from `@@ -a,b +c,d @@` (old-side when deletion-only). */
  newStart: number
  newCount: number
  oldStart: number
  oldCount: number
  text: string
}

interface PatchFile {
  /** b-side path ("+++"), falling back to a-side for deletions. */
  path: string
  oldPath: string | null
  header: string
  hunks: PatchHunk[]
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

function parsePathLine(line: string, prefix: 'a/' | 'b/'): string | null {
  // `+++ b/src/foo.ts` (tabs possible after path; quoted when exotic).
  let p = line.slice(4).trim()
  if (p === '/dev/null') return null
  if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1)
  return p.startsWith(prefix) ? p.slice(2) : p
}

export function parsePatch(patch: string): PatchFile[] {
  const files: PatchFile[] = []
  const chunks = patch.split(/^(?=diff --git )/m).filter((c) => c.startsWith('diff --git '))
  for (const chunk of chunks) {
    const lines = chunk.split('\n')
    let headerEnd = lines.length
    let path: string | null = null
    let oldPath: string | null = null
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (line.startsWith('--- ')) oldPath = parsePathLine(line, 'a/')
      if (line.startsWith('+++ ')) path = parsePathLine(line, 'b/')
      if (HUNK_RE.test(line)) {
        headerEnd = i
        break
      }
    }
    // Pure renames / mode changes have no ---/+++; take the b-side from `diff --git a/x b/y`.
    if (path === null) {
      const m = lines[0]!.match(/^diff --git (?:"?a\/)(.*?)"? (?:"?b\/)(.*?)"?$/)
      path = oldPath ?? m?.[2] ?? lines[0]!
    }

    const hunks: PatchHunk[] = []
    let current: { start: number; header: RegExpMatchArray } | null = null
    const flush = (end: number) => {
      if (!current) return
      const [, oldStart, oldCount, newStart, newCount] = current.header
      hunks.push({
        oldStart: Number(oldStart),
        oldCount: Number(oldCount ?? '1'),
        newStart: Number(newStart),
        newCount: Number(newCount ?? '1'),
        text: lines.slice(current.start, end).join('\n'),
      })
    }
    for (let i = headerEnd; i < lines.length; i++) {
      const m = lines[i]!.match(HUNK_RE)
      if (m) {
        flush(i)
        current = { start: i, header: m }
      }
    }
    flush(lines.length)

    files.push({ path, oldPath, header: lines.slice(0, headerEnd).join('\n'), hunks })
  }
  return files
}

/** Rebuilds a single-file patch containing only the hunks overlapping the range. */
function slicePatch(file: PatchFile, range?: { start: number; end: number }): string | null {
  let hunks = file.hunks
  if (range) {
    hunks = hunks.filter((h) => {
      // Deletion-only hunks have newCount 0; match on the old side instead.
      const [start, count] =
        h.newCount > 0 ? [h.newStart, h.newCount] : [h.oldStart, h.oldCount]
      return start <= range.end && start + Math.max(count, 1) - 1 >= range.start
    })
  }
  if (hunks.length === 0) return null
  const text = `${file.header}\n${hunks.map((h) => h.text).join('\n')}`
  return text.endsWith('\n') ? text : `${text}\n`
}

// ---------------------------------------------------------------------------
// Walkthrough: markdown + :::hunk / :::figure directives.

const FENCE_RE = /^(```|~~~)/
const DIRECTIVE_RE = /^:::(\w+)\s*(.*)$/

interface Segment {
  kind: 'prose' | 'directive'
  text: string
  line: number
}

function segmentWalkthrough(source: string): Segment[] {
  const segments: Segment[] = []
  let prose: string[] = []
  let proseStart = 1
  let fence: string | null = null
  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const fenceMatch = line.match(FENCE_RE)
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1]!
      else if (line.startsWith(fence)) fence = null
    }
    if (fence === null && DIRECTIVE_RE.test(line.trim())) {
      if (prose.some((l) => l.trim())) {
        segments.push({ kind: 'prose', text: prose.join('\n'), line: proseStart })
      }
      segments.push({ kind: 'directive', text: line.trim(), line: i + 1 })
      prose = []
      proseStart = i + 2
    } else {
      prose.push(line)
    }
  }
  if (prose.some((l) => l.trim())) {
    segments.push({ kind: 'prose', text: prose.join('\n'), line: proseStart })
  }
  return segments
}

/**
 * `path#L10-L40 "caption" height=360 collapsed` → parts. Quotes only around
 * the caption; bare words become boolean flags.
 */
function parseDirectiveArgs(rest: string): { target: string; caption?: string; attrs: Map<string, string> } {
  const attrs = new Map<string, string>()
  let caption: string | undefined
  const captionMatch = rest.match(/"([^"]*)"/)
  if (captionMatch) caption = captionMatch[1]!
  const withoutCaption = rest.replace(/"[^"]*"/, ' ')
  const tokens = withoutCaption.split(/\s+/).filter(Boolean)
  const target = tokens[0] ?? ''
  for (const token of tokens.slice(1)) {
    const eq = token.indexOf('=')
    if (eq > 0) attrs.set(token.slice(0, eq), token.slice(eq + 1))
    else attrs.set(token, 'true')
  }
  return { target, ...(caption !== undefined ? { caption } : {}), attrs }
}

/**
 * A Marked instance whose heading renderer assigns stable ids and records
 * h2/h3 entries into the ToC. Per-compile state, so ids stay deduplicated
 * across prose blocks without leaking between sessions.
 */
function createProseRenderer(toc: TocEntry[]): Marked {
  const slugCounts = new Map<string, number>()
  const instance = new Marked()
  instance.use({
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens)
        const text = html.replaceAll(/<[^>]+>/g, '').trim()
        const base =
          text.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '') || 'section'
        const count = slugCounts.get(base) ?? 0
        slugCounts.set(base, count + 1)
        const id = count === 0 ? base : `${base}-${count + 1}`
        if (depth === 2 || depth === 3) toc.push({ id, text, depth })
        return `<h${depth} id="${id}">${html}</h${depth}>\n`
      },
    },
  })
  return instance
}

function md(source: string): string {
  return marked.parse(source, { async: false })
}

function mdInline(source: string): string {
  return marked.parseInline(source, { async: false })
}

interface WalkthroughResult {
  title: string | null
  blocks: Block[]
  toc: TocEntry[]
  errors: CompileError[]
}

function compileWalkthrough(source: string, patchFiles: PatchFile[], paths: SessionPaths): WalkthroughResult {
  const errors: CompileError[] = []
  const blocks: Block[] = []
  const toc: TocEntry[] = []
  const prose = createProseRenderer(toc)
  let title: string | null = null

  const withoutComments = source.replaceAll(/<!--[\s\S]*?-->/g, '')
  if (!withoutComments.trim()) {
    return {
      title: null,
      blocks: [],
      toc: [],
      errors: [{ file: 'walkthrough.md', message: 'walkthrough.md has not been written yet' }],
    }
  }

  const byPath = new Map<string, PatchFile>()
  for (const f of patchFiles) {
    byPath.set(f.path, f)
    if (f.oldPath) byPath.set(f.oldPath, f)
  }

  for (const segment of segmentWalkthrough(withoutComments)) {
    if (segment.kind === 'prose') {
      // First h1 becomes the page title; the viewer renders it in the header.
      let text = segment.text
      if (title === null) {
        const h1 = text.match(/^# (.+)$/m)
        if (h1) {
          title = h1[1]!.trim()
          text = text.replace(/^# .+$/m, '')
        }
      }
      if (text.trim()) blocks.push({ kind: 'prose', html: prose.parse(text, { async: false }) })
      continue
    }

    const [, name, rest] = segment.text.match(DIRECTIVE_RE)!
    const { target, caption, attrs } = parseDirectiveArgs(rest!)
    const fail = (message: string) => errors.push({ file: 'walkthrough.md', line: segment.line, message })

    if (name === 'hunk') {
      const m = target.match(/^(.*?)(?:#L(\d+)(?:-L?(\d+))?)?$/)!
      const [, path, startStr, endStr] = m
      const file = byPath.get(path!)
      if (!path) {
        fail(':::hunk needs a file path')
        continue
      }
      if (!file) {
        fail(`:::hunk ${path}: not in this change. Changed files: ${[...new Set(patchFiles.map((f) => f.path))].join(', ')}`)
        continue
      }
      const range = startStr
        ? { start: Number(startStr), end: Number(endStr ?? startStr) }
        : undefined
      const slice = slicePatch(file, range)
      if (slice === null) {
        const available = file.hunks
          .map((h) => (h.newCount > 0 ? `L${h.newStart}-L${h.newStart + h.newCount - 1}` : `old L${h.oldStart}-L${h.oldStart + h.oldCount - 1}`))
          .join(', ')
        fail(
          file.hunks.length === 0
            ? `:::hunk ${path}: file has no hunks (pure rename or mode change)`
            : `:::hunk ${target}: no hunks overlap that range. Hunks in ${path}: ${available}`,
        )
        continue
      }
      // `collapsed` / `open` flags override the viewer's length-based default.
      const collapsed = attrs.has('collapsed') ? true : attrs.has('open') ? false : undefined
      blocks.push({
        kind: 'hunk',
        file: file.path,
        patch: slice,
        lines: slice.split('\n').length,
        ...(caption !== undefined ? { caption } : {}),
        ...(collapsed !== undefined ? { collapsed } : {}),
      })
    } else if (name === 'figure') {
      const normalized = normalize(target)
      if (!normalized.startsWith('figures/') || normalized.includes('..')) {
        fail(`:::figure ${target}: figures must live in this session's figures/ directory`)
        continue
      }
      if (!existsSync(join(paths.dir, normalized))) {
        fail(`:::figure ${target}: file not found in session directory`)
        continue
      }
      const height = attrs.has('height') ? Number(attrs.get('height')) : undefined
      if (height !== undefined && (!Number.isFinite(height) || height <= 0)) {
        fail(`:::figure ${target}: height must be a positive number`)
        continue
      }
      blocks.push({
        kind: 'figure',
        src: normalized,
        ...(caption !== undefined ? { caption } : {}),
        ...(height !== undefined ? { height } : {}),
      })
    } else {
      fail(`unknown directive :::${name} (supported: :::hunk, :::figure)`)
    }
  }

  return { title, blocks, toc, errors }
}

// ---------------------------------------------------------------------------
// Quiz: schema, then mechanical shuffle + position balancing.

const OptionSchema = z.object({
  text: z.string().min(1),
  correct: z.boolean().optional(),
  explanation: z.string().optional(),
})

const QuestionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('mcq'),
    prompt: z.string().min(1),
    options: z.array(OptionSchema).min(2).max(6),
    explanation: z.string().optional(),
  }),
  z.object({
    kind: z.literal('free'),
    prompt: z.string().min(1),
  }),
])

const QuizSchema = z.object({ questions: z.array(QuestionSchema) })

/** Deterministic PRNG so SSE reloads mid-quiz never reshuffle under the reader. */
function seededRng(seedText: string): () => number {
  let h = 2166136261
  for (const ch of seedText) {
    h ^= ch.codePointAt(0)!
    h = Math.imul(h, 16777619)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), h | 1)
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61)
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296
  }
}

function compileQuiz(source: string, seedText: string): { quiz: QuizQuestion[]; errors: CompileError[] } {
  const errors: CompileError[] = []
  let raw: unknown
  try {
    raw = parseYaml(source)
  } catch (err) {
    return { quiz: [], errors: [{ file: 'quiz.yaml', message: `invalid YAML: ${(err as Error).message}` }] }
  }

  const parsed = QuizSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      quiz: [],
      errors: parsed.error.issues.map((issue) => ({
        file: 'quiz.yaml',
        message: `${issue.path.join('.') || 'quiz'}: ${issue.message}`,
      })),
    }
  }
  if (parsed.data.questions.length === 0) {
    return { quiz: [], errors: [{ file: 'quiz.yaml', message: 'quiz.yaml has no questions yet' }] }
  }

  const rng = seededRng(seedText)
  // Balance: cycle the correct answer's display position across questions of
  // the same option count, starting at a seeded offset.
  const positionCounters = new Map<number, number>()

  const quiz: QuizQuestion[] = []
  parsed.data.questions.forEach((q, qi) => {
    const id = `q${qi + 1}`
    if (q.kind === 'free') {
      quiz.push({ kind: 'free', id, promptHtml: md(q.prompt) })
      return
    }

    const correctCount = q.options.filter((o) => o.correct).length
    if (correctCount !== 1) {
      errors.push({
        file: 'quiz.yaml',
        message: `question ${qi + 1}: exactly one option must have correct: true (found ${correctCount})`,
      })
      return
    }

    const k = q.options.length
    if (!positionCounters.has(k)) positionCounters.set(k, Math.floor(rng() * k))
    const counter = positionCounters.get(k)!
    positionCounters.set(k, counter + 1)
    const correctPos = counter % k

    const options: QuizOption[] = q.options.map((o, oi) => ({
      id: `${id}o${oi + 1}`,
      html: mdInline(o.text),
      ...(o.explanation !== undefined ? { explanationHtml: mdInline(o.explanation) } : {}),
    }))
    const correctIndex = q.options.findIndex((o) => o.correct)
    const correct = options[correctIndex]!
    const distractors = options.filter((_, oi) => oi !== correctIndex)
    // Fisher–Yates on the distractors, then insert the correct option.
    for (let i = distractors.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[distractors[i], distractors[j]] = [distractors[j]!, distractors[i]!]
    }
    distractors.splice(correctPos, 0, correct)

    quiz.push({
      kind: 'mcq',
      id,
      promptHtml: md(q.prompt),
      options: distractors,
      correctOptionId: correct.id,
      ...(q.explanation !== undefined ? { explanationHtml: mdInline(q.explanation) } : {}),
    })
  })

  return { quiz, errors }
}

// ---------------------------------------------------------------------------

export function compileSession(paths: SessionPaths): CompileResult {
  const manifest = readManifest(paths)
  const files = readFiles(paths)
  const patch = readFileSync(paths.patch, 'utf8')
  const walkthroughSource = readFileSync(paths.walkthrough, 'utf8')
  const quizSource = readFileSync(paths.quiz, 'utf8')

  const patchFiles = parsePatch(patch)
  const { title, blocks, toc, errors: wErrors } = compileWalkthrough(walkthroughSource, patchFiles, paths)
  const { quiz, errors: qErrors } = compileQuiz(quizSource, manifest.createdAt + manifest.branch)

  const errors = [...wErrors, ...qErrors]
  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    payload: {
      manifest,
      title: title ?? manifest.branch,
      walkthrough: blocks,
      toc,
      quiz,
      files,
      patch,
    },
  }
}

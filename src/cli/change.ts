/**
 * Change capture: everything git, behind one function.
 *
 * capturedChange = merge-base(base, HEAD) → working tree, uncommitted and
 * untracked files included, because sessions often end before a commit.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type { FileStatus, FileSummary, Manifest } from '../shared/payload.js'

export interface CapturedChange {
  manifest: Manifest
  patch: string
  files: FileSummary[]
}

export class ChangeError extends Error {}

/** Bases probed, in order, when origin/HEAD isn't set and no override given. */
const BASE_CANDIDATES = ['main', 'master', 'develop', 'trunk']

function git(repo: string, args: string[], allowFailure = false): string {
  try {
    return execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    // e.g. `diff --no-index` exits 1 when files differ; its stdout is the point.
    if (allowFailure) return (err as { stdout?: Buffer | string }).stdout?.toString() ?? ''
    const stderr = (err as { stderr?: Buffer | string }).stderr?.toString().trim()
    throw new ChangeError(`git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`)
  }
}

function refExists(repo: string, ref: string): boolean {
  try {
    execFileSync('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

/**
 * override → origin/HEAD → probe main/master/develop/trunk (remote first,
 * so a stale local `main` doesn't shadow the branch actually diverged from).
 */
export function detectBaseRef(repo: string, override?: string): string {
  if (override) {
    if (!refExists(repo, override)) {
      throw new ChangeError(`--base ${override} is not a commit in this repository`)
    }
    return override
  }
  const originHead = git(repo, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], true).trim()
  if (originHead) return originHead.replace('refs/remotes/', '')
  for (const name of BASE_CANDIDATES) {
    if (refExists(repo, `origin/${name}`)) return `origin/${name}`
    if (refExists(repo, name)) return name
  }
  throw new ChangeError(
    `could not detect a base branch (tried origin/HEAD, then ${BASE_CANDIDATES.join(', ')}); pass --base <ref>`,
  )
}

/** Synthesizes add-diffs for untracked files, which `git diff` won't show. */
function untrackedPatch(repo: string): string {
  const names = git(repo, ['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean)
  let patch = ''
  for (const name of names) {
    // Relative path (resolved via -C) keeps headers repo-relative: `+++ b/<name>`.
    patch += git(repo, ['diff', '--no-color', '--no-index', '--', '/dev/null', name], true)
  }
  return patch
}

function untrackedSummaries(repo: string): FileSummary[] {
  const names = git(repo, ['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean)
  return names.map((name) => {
    const numstat = git(repo, ['diff', '--numstat', '--no-index', '--', '/dev/null', name], true)
    const added = numstat.split('\t')[0]
    const binary = added === '-'
    return {
      path: name,
      status: 'added' as const,
      binary,
      additions: binary ? 0 : Number(added ?? 0),
      deletions: 0,
    }
  })
}

function statusOf(code: string): FileStatus {
  switch (code[0]) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    default:
      return 'modified'
  }
}

function trackedSummaries(repo: string, mergeBase: string): FileSummary[] {
  // --numstat gives counts ("-" for binary); --name-status gives status codes.
  const numstat = git(repo, ['diff', '-M', '--numstat', '-z', mergeBase])
  const nameStatus = git(repo, ['diff', '-M', '--name-status', '-z', mergeBase])

  const statuses = new Map<string, { status: FileStatus; prevPath?: string }>()
  const ns = nameStatus.split('\0').filter(Boolean)
  for (let i = 0; i < ns.length; ) {
    const code = ns[i]!
    if (code.startsWith('R') || code.startsWith('C')) {
      const [prevPath, path] = [ns[i + 1]!, ns[i + 2]!]
      statuses.set(path, { status: 'renamed', prevPath })
      i += 3
    } else {
      statuses.set(ns[i + 1]!, { status: statusOf(code) })
      i += 2
    }
  }

  const summaries: FileSummary[] = []
  // -z numstat entries: "add\tdel\tpath\0" or, for renames, "add\tdel\t\0old\0new\0"
  // (note the trailing tab: the counts token ends empty).
  const tokens = numstat.split('\0').filter(Boolean)
  for (let i = 0; i < tokens.length; ) {
    const parts = tokens[i]!.split('\t')
    const [added, deleted] = [parts[0]!, parts[1]!]
    let path: string
    if (parts.length === 2 || parts[2] === '') {
      path = tokens[i + 2]! // rename: old and new follow as separate tokens
      i += 3
    } else {
      path = parts[2]!
      i += 1
    }
    const binary = added === '-'
    const meta = statuses.get(path) ?? { status: 'modified' as const }
    summaries.push({
      path,
      ...(meta.prevPath !== undefined ? { prevPath: meta.prevPath } : {}),
      status: meta.status,
      binary,
      additions: binary ? 0 : Number(added),
      deletions: binary ? 0 : Number(deleted),
    })
  }
  return summaries
}

/**
 * Identifies the repository across worktrees: all worktrees share a
 * git-common-dir, so sessions from any of them land in one archive.
 */
function repoSlug(repo: string): string {
  let commonDir = git(repo, ['rev-parse', '--git-common-dir']).trim()
  if (!isAbsolute(commonDir)) commonDir = resolve(repo, commonDir)
  const mainRoot = basename(dirname(commonDir))
  const hash = createHash('sha256').update(commonDir).digest('hex').slice(0, 6)
  return `${sanitize(mainRoot)}-${hash}`
}

function sanitize(name: string): string {
  return name.toLowerCase().replaceAll(/[^a-z0-9._-]+/g, '-').replaceAll(/^-+|-+$/g, '') || 'repo'
}

export function captureChange(cwd: string, baseOverride?: string): CapturedChange {
  const repoRoot = git(cwd, ['rev-parse', '--show-toplevel'], true).trim()
  if (!repoRoot) throw new ChangeError(`not inside a git repository: ${cwd}`)

  const baseRef = detectBaseRef(repoRoot, baseOverride)
  const head = git(repoRoot, ['rev-parse', 'HEAD']).trim()
  const mergeBase = git(repoRoot, ['merge-base', baseRef, 'HEAD']).trim()
  const branch = git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
  const dirty = git(repoRoot, ['status', '--porcelain'], true).trim().length > 0

  // merge-base → working tree (staged + unstaged), then synthesized untracked adds.
  const patch =
    git(repoRoot, ['diff', '-M', '--no-color', mergeBase]) + untrackedPatch(repoRoot)
  const files = [...trackedSummaries(repoRoot, mergeBase), ...untrackedSummaries(repoRoot)]

  if (!patch.trim()) {
    throw new ChangeError(
      `no changes found between ${baseRef} (merge-base ${mergeBase.slice(0, 8)}) and the working tree`,
    )
  }

  return {
    manifest: {
      version: 1,
      repoRoot,
      repoSlug: repoSlug(repoRoot),
      branch,
      baseRef,
      mergeBase,
      head,
      dirty,
      createdAt: new Date().toISOString(),
    },
    patch,
    files,
  }
}

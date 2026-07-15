import { useEffect, useMemo, useRef, useState } from 'react'
import { PatchDiff } from '@pierre/diffs/react'
import { FileTree, useFileTree } from '@pierre/trees/react'
import type { FileSummary } from '@shared/payload'

const SPLIT_OPTIONS = {
  diffStyle: 'split',
  themeType: 'system',
  overflow: 'wrap',
} as const

const UNIFIED_OPTIONS = {
  diffStyle: 'unified',
  themeType: 'system',
  overflow: 'wrap',
} as const

const WIDE_QUERY = '(min-width: 1100px)'

function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY)
    const onChange = () => setWide(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return wide
}

/** Splits the captured multi-file patch into per-file patches, keyed by path. */
function usePatchSlices(patch: string): Map<string, string> {
  return useMemo(() => {
    const chunks = patch.split(/^(?=diff --git )/m).filter((c) => c.startsWith('diff --git '))
    const byPath = new Map<string, string>()
    for (const chunk of chunks) {
      const newSide = chunk.match(/^\+\+\+ "?b\/(.*?)"?\s*$/m)?.[1]
      const oldSide = chunk.match(/^--- "?a\/(.*?)"?\s*$/m)?.[1]
      const gitLine = chunk.match(/^diff --git "?a\/.*?"? "?b\/(.*?)"?$/m)?.[1]
      const path = newSide ?? oldSide ?? gitLine
      if (path) byPath.set(path, chunk)
    }
    return byPath
  }, [patch])
}

function sliceFor(slices: Map<string, string>, file: FileSummary): string | undefined {
  return slices.get(file.path) ?? (file.prevPath ? slices.get(file.prevPath) : undefined)
}

/**
 * The raw material, demoted to an appendix. Wide screens: a file-tree
 * navigator beside side-by-side diffs — selecting a file scrolls it into
 * view. Narrow screens: stacked unified diffs.
 */
export function Appendix({ files, patch }: { files: FileSummary[]; patch: string }) {
  const slices = usePatchSlices(patch)
  return useWide() ? (
    <WideAppendix files={files} slices={slices} />
  ) : (
    <NarrowAppendix files={files} slices={slices} />
  )
}

function WideAppendix({ files, slices }: { files: FileSummary[]; slices: Map<string, string> }) {
  const sections = useRef(new Map<string, HTMLElement>())
  const { model } = useFileTree({
    paths: files.map((f) => f.path),
    gitStatus: files.map((f) => ({ path: f.path, status: f.status })),
    initialExpansion: 'open',
    flattenEmptyDirectories: true,
    onSelectionChange: (paths) => {
      const path = paths[0]
      if (path) sections.current.get(path)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
  })

  return (
    <div className="appendix-wide">
      <aside className="appendix-tree" aria-label="changed files">
        <FileTree model={model} />
      </aside>
      <div className="appendix-diffs">
        {files.map((file) => {
          const slice = sliceFor(slices, file)
          return (
            <section
              key={file.path}
              className="appendix-diff-section"
              ref={(el) => {
                if (el) sections.current.set(file.path, el)
                else sections.current.delete(file.path)
              }}
            >
              {file.binary ? (
                <BinaryNote file={file} />
              ) : slice ? (
                <PatchDiff patch={slice} options={SPLIT_OPTIONS} />
              ) : (
                <RenameNote file={file} />
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function NarrowAppendix({ files, slices }: { files: FileSummary[]; slices: Map<string, string> }) {
  return (
    <div className="appendix">
      {files.map((file) => {
        const slice = sliceFor(slices, file)
        return (
          <details key={file.path} className="appendix-file" open={files.length <= 4}>
            <summary>
              <code className="appendix-path">
                {file.status === 'renamed' && file.prevPath ? `${file.prevPath} → ` : ''}
                {file.path}
              </code>
              <span className={`file-status file-status-${file.status}`}>{file.status}</span>
              {!file.binary && (
                <span className="file-counts">
                  <span className="additions">+{file.additions}</span>{' '}
                  <span className="deletions">−{file.deletions}</span>
                </span>
              )}
            </summary>
            {file.binary ? (
              <BinaryNote file={file} />
            ) : slice ? (
              <PatchDiff patch={slice} options={UNIFIED_OPTIONS} />
            ) : (
              <RenameNote file={file} />
            )}
          </details>
        )
      })}
    </div>
  )
}

function BinaryNote({ file }: { file: FileSummary }) {
  return (
    <p className="appendix-note">
      <code className="appendix-path">{file.path}</code> — binary file, no textual diff.
    </p>
  )
}

function RenameNote({ file }: { file: FileSummary }) {
  return (
    <p className="appendix-note">
      <code className="appendix-path">
        {file.prevPath} → {file.path}
      </code>{' '}
      — no content changes (rename or mode change).
    </p>
  )
}

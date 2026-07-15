import { useMemo } from 'react'
import { PatchDiff } from '@pierre/diffs/react'
import type { FileSummary } from '@shared/payload'

const DIFF_OPTIONS = {
  diffStyle: 'unified',
  themeType: 'system',
  overflow: 'wrap',
} as const

/**
 * The raw material, demoted to an appendix: every file's diff, deterministic
 * and complete, for when the narrative isn't enough.
 */
export function Appendix({ files, patch }: { files: FileSummary[]; patch: string }) {
  // Split the multi-file patch into per-file patches; each renders on demand.
  const slices = useMemo(() => {
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

  return (
    <div className="appendix">
      {files.map((file) => {
        const slice = slices.get(file.path) ?? (file.prevPath ? slices.get(file.prevPath) : undefined)
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
              <p className="appendix-binary">Binary file — no textual diff.</p>
            ) : slice ? (
              <PatchDiff patch={slice} options={DIFF_OPTIONS} />
            ) : (
              <p className="appendix-binary">No content changes (rename or mode change).</p>
            )}
          </details>
        )
      })}
    </div>
  )
}

import { useState } from 'react'
import { PatchDiff } from '@pierre/diffs/react'
import type { Block } from '@shared/payload'

const DIFF_OPTIONS = {
  diffStyle: 'unified',
  themeType: 'system',
  overflow: 'wrap',
} as const

/** Hunks longer than this start collapsed unless the author says otherwise. */
const AUTO_COLLAPSE_LINES = 48

/**
 * The literate walkthrough: prose interleaved with real rendered hunks and
 * iframed figures. Prose HTML was produced by the CLI's compile step from
 * model-authored markdown; hunks were sliced from the captured patch.
 */
export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'prose':
            return <div key={i} className="prose" dangerouslySetInnerHTML={{ __html: block.html }} />
          case 'hunk':
            return <HunkBlock key={i} block={block} />
          case 'figure':
            return (
              <figure key={i} className="embedded-figure">
                <iframe
                  src={`/${block.src}`}
                  title={block.caption ?? block.src}
                  sandbox="allow-scripts"
                  style={{ height: block.height ?? 320 }}
                />
                {block.caption && <figcaption>{block.caption}</figcaption>}
              </figure>
            )
        }
      })}
    </>
  )
}

/**
 * An in-walkthrough hunk. Long slices start collapsed (the library's
 * `collapsed` option renders just the file header) with our toggle beneath —
 * the narrative stays skimmable, the code one click away.
 */
function HunkBlock({ block }: { block: Extract<Block, { kind: 'hunk' }> }) {
  const [collapsed, setCollapsed] = useState(block.collapsed ?? block.lines > AUTO_COLLAPSE_LINES)
  return (
    <figure className="embedded-hunk">
      <PatchDiff patch={block.patch} options={{ ...DIFF_OPTIONS, collapsed }} />
      <button type="button" className="hunk-toggle" onClick={() => setCollapsed((c) => !c)}>
        {collapsed ? `Show diff · ${block.lines} lines` : 'Collapse diff'}
      </button>
      {block.caption && <figcaption>{block.caption}</figcaption>}
    </figure>
  )
}

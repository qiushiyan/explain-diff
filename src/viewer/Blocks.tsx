import { PatchDiff } from '@pierre/diffs/react'
import type { Block } from '@shared/payload'

const DIFF_OPTIONS = {
  diffStyle: 'unified',
  themeType: 'system',
  overflow: 'wrap',
} as const

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
            return (
              <figure key={i} className="embedded-hunk">
                <PatchDiff patch={block.patch} options={DIFF_OPTIONS} />
                {block.caption && <figcaption>{block.caption}</figcaption>}
              </figure>
            )
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

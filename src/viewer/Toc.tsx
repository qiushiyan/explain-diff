import { useEffect, useMemo, useRef, useState } from 'react'
import type { TocEntry } from '@shared/payload'

interface TocProps {
  toc: TocEntry[]
  hasQuiz: boolean
}

/**
 * Left-rail table of contents (wide screens). Top-level entries are the
 * page's fixed sections; the walkthrough's own h2/h3 headings nest under
 * Walkthrough. An IntersectionObserver drives the active highlight.
 */
export function Toc({ toc, hasQuiz }: TocProps) {
  const ids = useMemo(() => {
    const sections = ['walkthrough', ...toc.map((t) => t.id), ...(hasQuiz ? ['quiz'] : []), 'appendix']
    return sections
  }, [toc, hasQuiz])
  const active = useScrollSpy(ids)

  // The active walkthrough heading also lights up its parent entry.
  const walkthroughActive = active === 'walkthrough' || toc.some((t) => t.id === active)

  const link = (id: string, label: string, className = '') => (
    <a href={`#${id}`} className={`${className} ${active === id ? 'is-active' : ''}`.trim()}>
      {label}
    </a>
  )

  return (
    <nav className="toc" aria-label="table of contents">
      {link('walkthrough', 'Walkthrough', walkthroughActive && active !== 'walkthrough' ? 'is-open' : '')}
      {toc.map((entry) =>
        link(entry.id, entry.text, entry.depth === 3 ? 'toc-sub toc-subsub' : 'toc-sub'),
      )}
      {hasQuiz && link('quiz', 'Quiz')}
      {link('appendix', 'Full diff')}
    </nav>
  )
}

/**
 * Active = the last heading whose top has passed the reading line (~28% down
 * the viewport), so exactly one entry is active at any offset. Elements are
 * resolved fresh on every measure: React re-sets prose innerHTML after the
 * first commit, so held references go stale — ids are the only durable
 * identity. Scroll drives measures while reading; the body ResizeObserver
 * catches layout shifts from async diff rendering, which move headings
 * without any scrolling.
 */
function useScrollSpy(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null)
  const key = ids.join(',')
  const frame = useRef(0)

  useEffect(() => {
    const measure = () => {
      const line = window.innerHeight * 0.28
      let current: string | null = null
      for (const id of ids) {
        const el = document.getElementById(id)
        if (!el) continue
        if (current === null || el.getBoundingClientRect().top <= line) current = id
      }
      setActive(current)
    }
    const schedule = () => {
      cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(measure)
    }

    const ro = new ResizeObserver(schedule)
    ro.observe(document.body)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    measure()

    return () => {
      ro.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      cancelAnimationFrame(frame.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return active
}

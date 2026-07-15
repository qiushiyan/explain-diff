import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionPayload, Transcript } from '@shared/payload'
import { Blocks } from './Blocks'
import { Quiz } from './Quiz'
import { Appendix } from './Appendix'
import { Toc } from './Toc'

interface CompileErrorWire {
  file: string
  line?: number
  message: string
}

type PayloadWire =
  | { ok: true; payload: SessionPayload }
  | { ok: false; errors: CompileErrorWire[] }

export function App() {
  const [result, setResult] = useState<PayloadWire | null>(null)
  const [transcript, setTranscript] = useState<Transcript | null>(null)

  const refetch = useCallback(async () => {
    const res = await fetch('/api/payload')
    setResult((await res.json()) as PayloadWire)
  }, [])

  useEffect(() => {
    void refetch()
    void fetch('/api/transcript').then(async (res) => {
      if (res.ok) setTranscript((await res.json()) as Transcript)
    })
    const events = new EventSource('/api/events')
    events.onmessage = (e) => {
      const event = JSON.parse(e.data as string) as { type: string }
      if (event.type === 'payload') void refetch()
    }
    return () => events.close()
  }, [refetch])

  // The page arrives empty and fills in after the payload fetch, which would
  // otherwise strand a #hash navigation at the top.
  const restoredHash = useRef(false)
  useEffect(() => {
    if (result?.ok && !restoredHash.current && location.hash) {
      restoredHash.current = true
      const scroll = () => document.getElementById(location.hash.slice(1))?.scrollIntoView()
      scroll()
      // Diffs above the anchor render asynchronously and shift the layout;
      // re-anchor once they've settled.
      setTimeout(scroll, 1200)
    }
  }, [result])

  if (result === null) return null

  if (!result.ok) {
    return (
      <main className="page">
        <section className="compile-errors">
          <h1>This explanation isn’t ready yet</h1>
          <p>The session has compile errors. This page reloads automatically once they’re fixed.</p>
          <ul>
            {result.errors.map((e, i) => (
              <li key={i}>
                <code>
                  {e.file}
                  {e.line !== undefined ? `:${e.line}` : ''}
                </code>{' '}
                {e.message}
              </li>
            ))}
          </ul>
        </section>
      </main>
    )
  }

  const { payload } = result
  const additions = payload.files.reduce((n, f) => n + f.additions, 0)
  const deletions = payload.files.reduce((n, f) => n + f.deletions, 0)

  return (
    <div className="layout">
      {/* ?? []: a server running an older CLI serves payloads without toc. */}
      <Toc toc={payload.toc ?? []} hasQuiz={payload.quiz.length > 0} />
      <div className="content-col">
      <header className="masthead">
        <nav className="masthead-nav">
          <a href="#walkthrough">Walkthrough</a>
          {payload.quiz.length > 0 && <a href="#quiz">Quiz</a>}
          <a href="#appendix">Full diff</a>
        </nav>
      </header>
      <main className="page">
        <section className="title-block">
          <h1>{payload.title}</h1>
          <p className="change-meta">
            <code>{payload.manifest.branch}</code> against <code>{payload.manifest.baseRef}</code>
            {' · '}
            {payload.files.length} {payload.files.length === 1 ? 'file' : 'files'}
            {' · '}
            <span className="additions">+{additions}</span> <span className="deletions">−{deletions}</span>
            {payload.manifest.dirty && ' · includes uncommitted changes'}
          </p>
        </section>

        <section id="walkthrough">
          <Blocks blocks={payload.walkthrough} />
        </section>

        {payload.quiz.length > 0 && (
          <section id="quiz">
            <h2 className="section-heading">Check your understanding</h2>
            <Quiz questions={payload.quiz} submitted={transcript} onSubmitted={setTranscript} />
          </section>
        )}

        <section id="appendix">
          <h2 className="section-heading">Appendix · the full diff</h2>
          <Appendix files={payload.files} patch={payload.patch} />
        </section>
      </main>
      </div>
    </div>
  )
}

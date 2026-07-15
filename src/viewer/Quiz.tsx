import { useMemo, useState } from 'react'
import type { QuizQuestion, Transcript, TranscriptAnswer } from '@shared/payload'

interface QuizProps {
  questions: QuizQuestion[]
  /** Non-null when this session's quiz was already submitted (reopened archive). */
  submitted: Transcript | null
  onSubmitted: (t: Transcript) => void
}

/**
 * MCQ grades instantly in-page; an answer locks once chosen so the transcript
 * reflects a real first attempt. Free-text goes to the agent ungraded.
 */
export function Quiz({ questions, submitted, onSubmitted }: QuizProps) {
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [freeTexts, setFreeTexts] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)

  // When reopening a submitted session, show the recorded answers read-only.
  const recorded = useMemo(() => {
    if (!submitted) return null
    const byId = new Map(submitted.answers.map((a) => [a.questionId, a]))
    return byId
  }, [submitted])

  const choiceOf = (qid: string): string | undefined => {
    const past = recorded?.get(qid)
    if (past?.kind === 'mcq') return past.selectedOptionId
    return choices[qid]
  }
  const freeTextOf = (qid: string): string => {
    const past = recorded?.get(qid)
    if (past?.kind === 'free') return past.text
    return freeTexts[qid] ?? ''
  }

  const allAnswered = questions.every((q) =>
    q.kind === 'mcq' ? choiceOf(q.id) !== undefined : freeTextOf(q.id).trim() !== '',
  )

  const mcqs = questions.filter((q) => q.kind === 'mcq')
  const correctCount = mcqs.filter((q) => choiceOf(q.id) === q.correctOptionId).length

  const submit = async () => {
    setSending(true)
    const answers: TranscriptAnswer[] = questions.map((q) => {
      if (q.kind === 'free') return { questionId: q.id, kind: 'free', text: freeTextOf(q.id).trim() }
      const selectedOptionId = choiceOf(q.id)!
      const option = q.options.find((o) => o.id === selectedOptionId)!
      return {
        questionId: q.id,
        kind: 'mcq',
        selectedOptionId,
        selectedText: stripTags(option.html),
        correct: selectedOptionId === q.correctOptionId,
      }
    })
    const transcript: Transcript = { version: 1, submittedAt: new Date().toISOString(), answers }
    const res = await fetch('/api/transcript', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(transcript),
    })
    setSending(false)
    if (res.ok) onSubmitted(transcript)
  }

  return (
    <div className="quiz">
      {questions.map((q, qi) => (
        <article key={q.id} className="quiz-card">
          <div className="quiz-prompt">
            <span className="quiz-number">{qi + 1}</span>
            <div className="prose" dangerouslySetInnerHTML={{ __html: q.promptHtml }} />
          </div>
          {q.kind === 'mcq' ? (
            <McqOptions question={q} selected={choiceOf(q.id)} locked={recorded !== null}
              onSelect={(oid) => setChoices((c) => (c[q.id] ? c : { ...c, [q.id]: oid }))} />
          ) : (
            <textarea
              className="quiz-free"
              placeholder="Answer in your own words — your agent will read and discuss this with you."
              value={freeTextOf(q.id)}
              readOnly={recorded !== null}
              rows={4}
              onChange={(e) => setFreeTexts((t) => ({ ...t, [q.id]: e.target.value }))}
            />
          )}
        </article>
      ))}

      {submitted ? (
        <div className="quiz-result" role="status">
          <strong>
            {correctCount}/{mcqs.length} correct.
          </strong>{' '}
          Answers sent to your agent — return to the terminal to discuss them.
        </div>
      ) : (
        <div className="quiz-submit">
          <button type="button" disabled={!allAnswered || sending} onClick={() => void submit()}>
            {sending ? 'Sending…' : 'Send answers to your agent'}
          </button>
          {!allAnswered && <span className="quiz-hint">Answer every question to submit.</span>}
        </div>
      )}
    </div>
  )
}

function McqOptions({
  question,
  selected,
  locked,
  onSelect,
}: {
  question: Extract<QuizQuestion, { kind: 'mcq' }>
  selected: string | undefined
  locked: boolean
  onSelect: (optionId: string) => void
}) {
  const answered = selected !== undefined
  return (
    <div className="quiz-options" role="listbox" aria-label="answer options">
      {question.options.map((option) => {
        const isSelected = selected === option.id
        const isCorrect = option.id === question.correctOptionId
        const revealed = answered && (isSelected || isCorrect)
        return (
          <button
            key={option.id}
            type="button"
            className={[
              'quiz-option',
              isSelected ? 'is-selected' : '',
              revealed && isCorrect ? 'is-correct' : '',
              revealed && isSelected && !isCorrect ? 'is-incorrect' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            disabled={answered || locked}
            onClick={() => onSelect(option.id)}
          >
            <span className="quiz-option-text" dangerouslySetInnerHTML={{ __html: option.html }} />
            {revealed && option.explanationHtml && (
              <span className="quiz-option-why" dangerouslySetInnerHTML={{ __html: option.explanationHtml }} />
            )}
          </button>
        )
      })}
      {answered && question.explanationHtml && (
        <div className="quiz-explanation prose" dangerouslySetInnerHTML={{ __html: question.explanationHtml }} />
      )}
    </div>
  )
}

function stripTags(html: string): string {
  const el = document.createElement('div')
  el.innerHTML = html
  return el.textContent ?? ''
}

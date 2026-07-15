#!/usr/bin/env node
/**
 * Terminal adapter: argument parsing and dispatch only. Output is JSON on
 * stdout (the consumer is usually a coding agent); diagnostics go to stderr.
 *
 * Exit codes: 0 ok · 1 error/invalid · 3 transcript not submitted yet.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { Command } from 'commander'
import { captureChange, ChangeError } from './change.js'
import { compileSession, type CompileError } from './compile.js'
import { createSession, readTranscript, resolveSession } from './session.js'
import { serve } from './serve.js'

const program = new Command('explain-diff')
  .description('Literate diff explainers with quizzes, for terminal coding agents')

program
  .command('new')
  .description('capture the current change and scaffold a session')
  .option('--base <ref>', 'base ref to explain against (default: auto-detected)')
  .option('--repo <dir>', 'repository to capture from', process.cwd())
  .action((opts: { base?: string; repo: string }) => {
    try {
      const capture = captureChange(opts.repo, opts.base)
      const paths = createSession(capture)
      console.log(
        JSON.stringify(
          {
            session: paths.dir,
            branch: capture.manifest.branch,
            baseRef: capture.manifest.baseRef,
            mergeBase: capture.manifest.mergeBase,
            dirty: capture.manifest.dirty,
            files: capture.files,
            authoring: {
              walkthrough: paths.walkthrough,
              quiz: paths.quiz,
              figures: paths.figuresDir,
            },
            next: `write walkthrough.md and quiz.yaml, then: explain-diff check ${paths.dir}`,
          },
          null,
          2,
        ),
      )
    } catch (err) {
      fail(err)
    }
  })

program
  .command('check')
  .description('validate a session; errors are written for self-correction')
  .argument('<session>', 'session directory')
  .action((session: string) => {
    try {
      const result = compileSession(resolveSession(session))
      if (!result.ok) {
        for (const e of result.errors) console.error(formatError(e))
        process.exitCode = 1
        return
      }
      const { payload } = result
      console.log(
        JSON.stringify({
          ok: true,
          title: payload.title,
          blocks: payload.walkthrough.length,
          hunksEmbedded: payload.walkthrough.filter((b) => b.kind === 'hunk').length,
          questions: payload.quiz.length,
          filesInChange: payload.files.length,
        }),
      )
    } catch (err) {
      fail(err)
    }
  })

program
  .command('open')
  .description('serve the session viewer and open the browser')
  .argument('<session>', 'session directory')
  .option('--port <port>', 'port to serve on', '4747')
  .option('--no-open', 'do not open the browser')
  .action(async (session: string, opts: { port: string; open: boolean }) => {
    try {
      const paths = resolveSession(session)
      const result = compileSession(paths)
      if (!result.ok) {
        console.error('session has compile errors (serving anyway; fix and the page will live-reload):')
        for (const e of result.errors) console.error(formatError(e))
      }
      await serve(paths, { port: Number(opts.port), openBrowser: opts.open })
    } catch (err) {
      fail(err)
    }
  })

program
  .command('answers')
  .description('read the quiz transcript; exit 3 while the reader is still answering')
  .argument('<session>', 'session directory')
  .option('--wait <seconds>', 'poll this long before giving up', '0')
  .action(async (session: string, opts: { wait: string }) => {
    try {
      const paths = resolveSession(session)
      const deadline = Date.now() + Number(opts.wait) * 1000
      let transcript = readTranscript(paths)
      while (!transcript && Date.now() < deadline) {
        await sleep(2000)
        transcript = readTranscript(paths)
      }
      if (!transcript) {
        console.error('no transcript yet — the reader has not submitted the quiz')
        process.exitCode = 3
        return
      }
      console.log(JSON.stringify(mergeTranscript(paths, transcript), null, 2))
    } catch (err) {
      fail(err)
    }
  })

/**
 * Joins the transcript with question data so the agent gets everything in one
 * read: prompt, what was chosen, what was right, and the explanations.
 */
function mergeTranscript(paths: ReturnType<typeof resolveSession>, transcript: unknown) {
  const result = compileSession(paths)
  const t = transcript as import('../shared/payload.js').Transcript
  if (!result.ok) return { submittedAt: t.submittedAt, answers: t.answers }

  const questions = new Map(result.payload.quiz.map((q) => [q.id, q]))
  return {
    submittedAt: t.submittedAt,
    score: {
      mcqCorrect: t.answers.filter((a) => a.kind === 'mcq' && a.correct).length,
      mcqTotal: t.answers.filter((a) => a.kind === 'mcq').length,
      freeText: t.answers.filter((a) => a.kind === 'free').length,
    },
    answers: t.answers.map((a) => {
      const q = questions.get(a.questionId)
      const prompt = q ? stripHtml(q.promptHtml) : a.questionId
      if (a.kind === 'free') {
        return { question: prompt, kind: 'free' as const, answer: a.text, note: 'grade this yourself' }
      }
      const mcq = q?.kind === 'mcq' ? q : null
      const correctOption = mcq?.options.find((o) => o.id === mcq.correctOptionId)
      return {
        question: prompt,
        kind: 'mcq' as const,
        correct: a.correct,
        selected: a.selectedText,
        correctAnswer: correctOption ? stripHtml(correctOption.html) : undefined,
        explanation: mcq?.explanationHtml ? stripHtml(mcq.explanationHtml) : undefined,
      }
    }),
  }
}

function stripHtml(html: string): string {
  return html
    .replaceAll(/<[^>]+>/g, '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .trim()
}

function formatError(e: CompileError): string {
  return `${e.file}${e.line !== undefined ? `:${e.line}` : ''}: ${e.message}`
}

function fail(err: unknown): never {
  const message = err instanceof ChangeError || err instanceof Error ? err.message : String(err)
  console.error(`explain-diff: ${message}`)
  process.exit(1)
}

await program.parseAsync()

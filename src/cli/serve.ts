/**
 * Serves the prebuilt viewer plus one session's data, and receives the
 * transcript. The answer channel is the filesystem: the transcript is written
 * atomically into the session dir, where `explain-diff answers` polls for it —
 * the two processes never need each other alive.
 *
 * Session files are watched; on change the payload is recompiled and an SSE
 * ping tells the viewer to refetch, so the agent can revise the walkthrough
 * mid-conversation and the open page updates live.
 */
import { watch, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { z } from 'zod'
import type { ServerEvent, Transcript } from '../shared/payload.js'
import { compileSession, type CompileResult } from './compile.js'
import { writeTranscript, type SessionPaths } from './session.js'

const VIEWER_DIR = fileURLToPath(new URL('../viewer', import.meta.url))

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}

const TranscriptSchema = z.object({
  version: z.literal(1),
  submittedAt: z.string(),
  answers: z.array(
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('mcq'),
        questionId: z.string(),
        selectedOptionId: z.string(),
        selectedText: z.string(),
        correct: z.boolean(),
      }),
      z.object({ kind: z.literal('free'), questionId: z.string(), text: z.string() }),
    ]),
  ),
})

export interface ServeOptions {
  port: number
  openBrowser: boolean
}

export async function serve(paths: SessionPaths, options: ServeOptions): Promise<void> {
  let compiled: CompileResult = compileSession(paths)
  const sseClients = new Set<ServerResponse>()

  const broadcast = (event: ServerEvent) => {
    for (const res of sseClients) res.write(`data: ${JSON.stringify(event)}\n\n`)
  }

  // Recompile on session-file changes; transcript writes announce themselves.
  let debounce: NodeJS.Timeout | null = null
  const watcher = watch(paths.dir, { recursive: true }, (_event, filename) => {
    if (filename?.startsWith('transcript.json')) return
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      compiled = compileSession(paths)
      broadcast({ type: 'payload' })
    }, 200)
  })

  const serveFile = (res: ServerResponse, filePath: string): boolean => {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return false
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' })
    res.end(readFileSync(filePath))
    return true
  }

  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const pathname = decodeURIComponent(url.pathname)

    if (pathname === '/api/payload') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(compiled))
      return
    }

    if (pathname === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      res.write(':\n\n')
      sseClients.add(res)
      req.on('close', () => sseClients.delete(res))
      return
    }

    // Lets a reopened archive session show its recorded answers.
    if (pathname === '/api/transcript' && req.method === 'GET') {
      if (!serveFile(res, paths.transcript)) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end('null')
      }
      return
    }

    if (pathname === '/api/transcript' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk: Buffer) => (body += chunk.toString()))
      req.on('end', () => {
        const parsed = TranscriptSchema.safeParse(JSON.parse(body || 'null'))
        if (!parsed.success) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: parsed.error.message }))
          return
        }
        writeTranscript(paths, parsed.data as Transcript)
        broadcast({ type: 'transcript' })
        res.writeHead(204)
        res.end()
      })
      return
    }

    // Model-authored figures, iframed by the viewer; confined to figures/.
    if (pathname.startsWith('/figures/')) {
      const rel = normalize(pathname.slice('/figures/'.length))
      if (!rel.includes('..') && serveFile(res, join(paths.figuresDir, rel))) return
      res.writeHead(404)
      res.end('not found')
      return
    }

    // The prebuilt viewer. Unknown paths fall back to index.html.
    const rel = normalize(pathname === '/' ? 'index.html' : pathname.slice(1))
    if (!rel.includes('..') && serveFile(res, join(VIEWER_DIR, rel))) return
    if (serveFile(res, join(VIEWER_DIR, 'index.html'))) return
    res.writeHead(404)
    res.end('viewer not built — run pnpm build:viewer')
  }

  const server = createServer(handle)
  const port = await listen(server, options.port)
  const address = `http://localhost:${port}`
  console.log(`explain-diff: serving ${paths.dir}`)
  console.log(`explain-diff: ${address}`)

  if (options.openBrowser) {
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
    spawn(opener, [address], { stdio: 'ignore', detached: true }).unref()
  }

  await new Promise<void>((resolvePromise) => {
    process.on('SIGINT', () => {
      watcher.close()
      server.close()
      resolvePromise()
    })
  })
}

/** Binds the requested port, walking upward when it's taken. */
function listen(server: ReturnType<typeof createServer>, port: number): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    let attempt = port
    const tryListen = () => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attempt < port + 20) {
          attempt += 1
          tryListen()
        } else {
          reject(err)
        }
      })
      server.listen(attempt, '127.0.0.1', () => resolvePromise(attempt))
    }
    tryListen()
  })
}

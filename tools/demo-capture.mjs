/**
 * Product demo capture: a scripted tour of the phone UI with entirely synthetic
 * data. No real host, session, device name, account or message is used.
 *
 *   node tools/demo-capture.mjs
 *
 * Writes docs/demo/demo.mp4, docs/demo/demo.gif and three stills.
 * Requires Chrome and ffmpeg on PATH (or the usual Windows install locations).
 */
import { createServer } from 'node:http'
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const WEB = join(ROOT, 'web')
const OUT = join(ROOT, 'docs', 'demo')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const FPS = 10
const SECONDS = 13

/* ------------------------------ synthetic data ------------------------------ */

const sessions = [
  { id: 'demo-1', title: 'Refactor the auth middleware', running: true, blank: false, updatedAt: Date.now() - 60_000, cwd: 'C:\\work\\studio-app' },
  { id: 'demo-2', title: 'Write release notes for 2.4', running: false, blank: false, updatedAt: Date.now() - 9 * 60_000, cwd: 'C:\\work\\studio-app' },
  { id: 'demo-3', title: 'Debug the flaky upload test', running: false, blank: false, updatedAt: Date.now() - 41 * 60_000, cwd: 'C:\\work\\service' },
  { id: 'demo-4', title: 'Explain the retry policy', running: false, blank: false, updatedAt: Date.now() - 3 * 3600_000, cwd: 'C:\\work\\docs' },
  { id: 'demo-5', title: 'Tidy the settings screen', running: false, blank: false, updatedAt: Date.now() - 26 * 3600_000, cwd: 'C:\\work\\studio-app' },
]

const transcript = [
  { seq: 1, type: 'turn/start', data: { turn: 4 } },
  { seq: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'The auth middleware keeps losing the refresh token. Can you find it and fix the tests?' }] } },
  { seq: 3, type: 'assistant/message', data: { message: { content: [
    { type: 'reasoning', text: 'Two places touch the token: the loader reads it, the refresh path writes it. The loader caches the parsed header, so a rotated token stays stale.' },
    { type: 'text', text: 'Found it. `readToken()` caches the parsed header for the whole process, so a rotation is invisible until restart.' },
  ] } } },
  { seq: 4, type: 'tool/call', data: { callId: 't1', name: 'read', arguments: JSON.stringify({ path: 'src/auth/token.ts' }) } },
  { seq: 5, type: 'tool/result', data: { message: { toolCallId: 't1', isError: false, content: [{ type: 'text', text: 'export function readToken() {\n  if (cached) return cached\n  …\n}' }] } } },
  { seq: 6, type: 'tool/call', data: { callId: 't2', name: 'edit', arguments: JSON.stringify({ path: 'src/auth/token.ts' }) } },
  { seq: 7, type: 'tool/result', data: { message: { toolCallId: 't2', isError: false, content: [{ type: 'text', text: 'updated 1 file: cache keyed by token generation' }] } } },
  { seq: 8, type: 'tool/call', data: { callId: 't3', name: 'pwsh', arguments: JSON.stringify({ command: 'npm test -- auth' }) } },
  { seq: 9, type: 'tool/result', data: { message: { toolCallId: 't3', isError: false, content: [{ type: 'text', text: 'PASS src/auth/token.test.ts (12 tests)\nTests: 12 passed' }] } } },
  { seq: 10, type: 'assistant/message', data: { message: { content: [
    { type: 'text', text: 'The fix keys the cache by token generation, so a rotation invalidates it immediately.\n\n| file | change |\n| --- | --- |\n| `src/auth/token.ts` | cache keyed by generation |\n| `src/auth/token.test.ts` | rotation test |\n\nAll 12 auth tests pass.' },
  ] } } },
  { seq: 11, type: 'turn/end', data: { turn: 4, reason: { kind: 'completed' } } },
]

const approval = {
  requestId: 'demo-approval',
  kind: 'approval',
  toolName: 'pwsh',
  reason: 'This command needs permission to run.',
  displayReason: { en: 'This command needs permission to run.', zh: '该命令需要授权才能运行。' },
}

const pendingStream = { type: 'assistant-stream', frame: { type: 'start' } }

/* -------------------------------- mock host -------------------------------- */

const clients = new Set()
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
const emit = (frame) => { for (const res of clients) { try { res.write(`data: ${JSON.stringify(frame)}\n\n`) } catch { /* closed */ } } }

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const path = url.pathname
  if (path === '/api/me') return json(res, 200, { authenticated: true })
  if (path === '/api/sessions') return json(res, 200, { items: sessions, total: sessions.length, nextCursor: null })
  if (path === '/api/state') return json(res, 200, { active: true, running: true, queue: [] })
  if (path === '/api/history') return json(res, 200, { records: [], hasMore: false })
  if (path === '/api/notify/action') return json(res, 200, {})
  if (path === '/api/prompt' || path === '/api/queue' || path === '/api/answer' || path === '/api/approval') return json(res, 200, { ok: true })
  if (path === '/api/demo/emit' && req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => { try { emit(JSON.parse(body)) } catch { /* ignore */ } ; json(res, 200, { ok: true }) })
    return
  }
  if (path === '/api/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
    const records = transcript.map((event) => ({ type: 'event', event }))
    res.write(`data: ${JSON.stringify({ type: 'snapshot', cursor: 11, records })}\n\n`)
    const ping = setInterval(() => { try { res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`) } catch { /* closed */ } }, 5000)
    clients.add(res)
    req.on('close', () => { clearInterval(ping); clients.delete(res) })
    return
  }
  if (path.startsWith('/api/')) return json(res, 200, {})
  try {
    const file = path === '/' ? 'index.html' : path.slice(1)
    const body = await readFile(join(WEB, file))
    const type = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html'
    res.writeHead(200, { 'content-type': type })
    res.end(body)
  } catch { res.writeHead(404); res.end('not found') }
})

/* --------------------------------- browser --------------------------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const profile = mkdtempSync(join(tmpdir(), 'rc-demo-'))
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', '--remote-debugging-port=0', '--hide-scrollbars', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })

async function devtoolsPort() {
  for (let i = 0; i < 120; i++) {
    try {
      const text = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim()
      if (text) return Number(text)
    } catch { /* not written yet */ }
    await sleep(120)
  }
  throw new Error('devtools never came up')
}
const devPort = await devtoolsPort()
let ws
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${devPort}/json/version`)
    if (r.ok) { ws = new WebSocket((await r.json()).webSocketDebuggerUrl); break }
  } catch { /* not up */ }
  await sleep(150)
}
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
let nextId = 1
const pending = new Map()
ws.onmessage = (event) => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } }
const send = (method, params = {}, sessionId) => {
  const id = nextId++
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  return new Promise((resolve, reject) => pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result))))
}
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Runtime.enable', {}, sessionId)
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sessionId)
await send('Page.navigate', { url: base }, sessionId)
await sleep(2500)

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
const screenshot = async () => {
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 }, sessionId)
  return Buffer.from(shot.data, 'base64')
}
const emitFrame = (frame) => evaluate(`fetch('/api/demo/emit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(frame))} }).then(() => true)`)

/* -------------------------------- storyboard -------------------------------- */

const framesDir = mkdtempSync(join(tmpdir(), 'rc-demo-frames-'))
const clicks = (selector) => evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.click(); return true })()`)

// narration state lives on the page so it is captured in every frame
await evaluate(`(() => {
  const badge = document.createElement('div')
  badge.id = 'demo-caption'
  badge.textContent = 'Paired desktops in your sidebar'
  document.body.append(badge)
  const style = document.createElement('style')
  style.textContent = '#demo-caption { position: fixed; left: 14px; right: 14px; top: 104px; z-index: 9999; padding: 10px 14px; border-radius: 12px; background: rgba(16,18,24,.88); color: #fff; font: 600 14px/1.35 system-ui, sans-serif; box-shadow: 0 8px 24px rgba(0,0,0,.35); }'
  document.head.append(style)
  return true
})()`)
const caption = (text) => evaluate(`(() => { const node = document.getElementById('demo-caption'); if (node) node.textContent = ${JSON.stringify(text)}; return true })()`)

const timeline = [
  { at: 300, run: async () => { await clicks('#menu'); await caption('One panel lists every paired desktop') } },
  { at: 2200, run: async () => { await clicks('#session-list .session-item'); await caption('Open a session and keep talking to it') } },
  { at: 3400, run: async () => {
    await caption('Live reasoning, tool calls and results')
    await emitFrame(pendingStream)
    await emitFrame({ type: 'assistant-stream', frame: { type: 'chunk', chunk: { type: 'reasoning-delta', text: 'This is a fresh question about the retry policy. ' } } })
  } },
  { at: 3900, run: async () => { await caption('Enter types a newline; Ctrl+Enter sends') } },
  { at: 4000, run: async () => { await evaluate(`(() => { const input = document.getElementById('input'); input.value = 'Now add a retry test and send me the diff.'; input.dispatchEvent(new Event('input')); return true })()`) } },
  { at: 5200, run: async () => { await clicks('#send'); await caption('Queued behind the running turn, then delivered') } },
  { at: 6400, run: async () => {
    await caption('Approvals arrive on the phone too')
    await emitFrame({ type: 'hitl/request', ...approval })
  } },
  { at: 8200, run: async () => {
    await clicks('.hitl-actions button')
    await caption('Answer at a tap: Allow or Deny')
    await emitFrame({ type: 'event', event: { seq: 12, type: 'hitl/decided', data: { requestId: approval.requestId, decision: 'allow' } } })
  } },
  { at: 9400, run: async () => {
    await caption('Then the transcript keeps streaming')
    await emitFrame({ type: 'assistant-stream', frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'Added `retry.test.ts`: it fails twice, then succeeds, and asserts three attempts.' } } })
  } },
  { at: 10400, run: async () => {
    await emitFrame({ type: 'assistant-stream', frame: { type: 'end' } })
    await caption('Same session, from any device')
  } },
  { at: 11600, run: async () => { await clicks('#menu'); await caption('Sessions, status and folder at a glance') } },
]

const totalFrames = FPS * SECONDS
const stills = new Map()
for (let index = 0; index < totalFrames; index += 1) {
  const at = Math.round((index * 1000) / FPS)
  for (const step of timeline) {
    if (step.at >= at && step.at < at + 1000 / FPS) await step.run()
  }
  const buffer = await screenshot()
  await writeFile(join(framesDir, `frame-${String(index).padStart(4, '0')}.jpg`), buffer)
  if (at === 1400) stills.set('phone-sessions.jpg', buffer)
  if (at === 4600) stills.set('phone-chat.jpg', buffer)
  if (at === 7000) stills.set('phone-approval.jpg', buffer)
}

ws.close()
chrome.kill()
server.close()

/* --------------------------------- encode ---------------------------------- */

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })
for (const [name, buffer] of stills) await writeFile(join(OUT, name), buffer)

const ffmpeg = (args) => new Promise((resolve, reject) => {
  const child = spawn('ffmpeg.exe', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })
  child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg exited ' + code))))
})
const input = ['-framerate', String(FPS), '-i', join(framesDir, 'frame-%04d.jpg')]
await ffmpeg([...input, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(OUT, 'demo.mp4')])
await ffmpeg([...input, '-vf', 'fps=8,scale=390:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse', join(OUT, 'demo.gif')])
await rm(framesDir, { recursive: true, force: true })
console.log('wrote', OUT)

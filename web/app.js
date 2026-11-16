const $ = (id) => document.getElementById(id)

const el = {
  login: $('login'),
  app: $('app'),
  pairForm: $('pair-form'),
  code: $('code'),
  pairSubmit: $('pair-submit'),
  pairError: $('pair-error'),
  menu: $('menu'),
  drawer: $('drawer'),
  closeButton: $('close-drawer'),
  attach: $('attach'),
  fileInput: $('file-input'),
  attachmentsEl: $('attachments'),
  queue: $('queue'),
  modeSwitch: $('mode-switch'),
  modeRow: $('mode-row'),
  configButton: $('config'),
  configSheet: $('config-sheet'),
  fileView: $('file-view'),
  fileTitle: $('file-title'),
  fileBody: $('file-body'),
  fileClose: $('file-close'),
  configClose: $('config-close'),
  modelSelect: $('model-select'),
  permissionSelect: $('permission-select'),
  planToggle: $('plan-toggle'),
  configStatus: $('config-status'),
  scrim: $('scrim'),
  sessionList: $('session-list'),
  newSession: $('new-session'),
  logout: $('logout'),
  title: $('session-title'),
  meta: $('session-meta'),
  status: $('status'),
  log: $('log'),
  empty: $('empty'),
  loadEarlier: $('load-earlier'),
  scrollJump: $('scroll-jump'),
  scrollTopBtn: $('scroll-top'),
  scrollBottomBtn: $('scroll-bottom'),
  composer: $('composer'),
  input: $('input'),
  send: $('send'),
  stop: $('stop'),
}

const SAVED_KEY = 'dsh-remote-control:phone:last'
const SCROLL_KEY = 'dsh-remote-control:phone:scroll'
let scrollSavedAt = 0

function savedSessionId() {
  try {
    const hash = window.location.hash || ''
    if (hash.length > 1) {
      const params = new URLSearchParams(hash.slice(1))
      if (params.get('session')) return params.get('session')
    }
    return window.localStorage?.getItem(SAVED_KEY) ?? null
  } catch {
    return null
  }
}

function rememberSession(id) {
  try { window.localStorage?.setItem(SAVED_KEY, id) } catch { /* storage unavailable */ }
  try {
    const params = new URLSearchParams()
    params.set('session', id)
    if (window.history?.replaceState) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${params.toString()}`)
    }
  } catch { /* ignore */ }
}

function savedScrollTop() {
  try { return Number(window.localStorage?.getItem(SCROLL_KEY)) || 0 } catch { return 0 }
}

function rememberScrollTop(value) {
  try { window.localStorage?.setItem(SCROLL_KEY, String(Math.max(0, Math.round(value)))) } catch { /* ignore */ }
}

const state = {
  sessions: [],
  sessionId: savedSessionId(),
  source: null,
  seen: new Set(),
  lastSeq: 0,
  running: false,
  pinned: true,
  live: null,
  liveText: '',
  tools: new Map(),
  pending: [],
  config: null,
  hitl: new Map(),
  mode: 'queue',
  earliestSeq: null,
  historyMore: true,
  queueItems: [],
}

let renderingHistory = false

/* ---------------- transport ---------------- */

async function request(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.message || data.error || `HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
  return data
}

/* ---------------- boot ---------------- */

boot()

async function boot() {
  try {
    const me = await request('/api/me')
    if (me.authenticated) startApp()
    else showLogin()
  } catch {
    showLogin()
  }
}

function showLogin() {
  el.app.hidden = true
  el.login.hidden = false
  el.code.focus()
}

el.pairForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  el.pairError.hidden = true
  el.pairSubmit.disabled = true
  try {
    await request('/api/pair', { code: el.code.value.trim() })
    // Drop a scanned ?code= so it does not linger in history or a bookmark.
    if (new URLSearchParams(location.search).has('code')) {
      history.replaceState(null, '', location.pathname)
    }
    location.reload()
  } catch (error) {
    el.pairError.textContent = error.message
    el.pairError.hidden = false
    el.code.select()
  } finally {
    el.pairSubmit.disabled = false
  }
})

// A QR scanned from the Devices panel carries the pairing code: pair at once
// instead of asking the user to retype six digits on a phone keyboard.
const scannedCode = new URLSearchParams(location.search).get('code')
if (scannedCode && /^\d{6}$/.test(scannedCode)) {
  el.code.value = scannedCode
  el.pairForm.requestSubmit()
}

function startApp() {
  el.login.hidden = true
  el.app.hidden = false

  el.menu.addEventListener('click', toggleDrawer)
  el.closeButton?.addEventListener('click', closeDrawer)
  el.scrim.addEventListener('click', closeDrawer)
  el.attach.addEventListener('click', () => { if (state.sessionId) el.fileInput.click() })
  if (el.loadEarlier) el.loadEarlier.addEventListener('click', loadEarlier)
  el.scrollTopBtn?.addEventListener('click', () => { el.log.scrollTo({ top: 0, behavior: 'smooth' }) })
  el.scrollBottomBtn?.addEventListener('click', () => {
    state.pinned = true
    el.log.scrollTo({ top: el.log.scrollHeight, behavior: 'smooth' })
  })
  for (const button of el.modeSwitch?.querySelectorAll('button[data-mode]') ?? []) {
    button.addEventListener('click', () => {
      state.mode = button.dataset.mode === 'steer' ? 'steer' : 'queue'
      for (const other of el.modeSwitch.querySelectorAll('button[data-mode]')) {
        other.setAttribute('aria-pressed', String(other.dataset.mode === state.mode))
      }
    })
  }
  el.fileInput.addEventListener('change', () => {
    const files = [...(el.fileInput.files || [])]
    el.fileInput.value = ''
    for (const file of files) uploadFile(file)
  })
  // Pasting a screenshot is the fastest path on a phone that cannot drag files.
  el.input.addEventListener('paste', (event) => {
    const items = event.clipboardData?.items ?? []
    const files = []
    for (const item of items) {
      if (item.kind !== 'file' || !String(item.type).startsWith('image/')) continue
      const file = item.getAsFile()
      if (file) files.push(file)
    }
    if (files.length === 0) return
    event.preventDefault()
    for (const file of files) uploadFile(file)
  })
  el.configButton.addEventListener('click', openConfig)
  el.configClose.addEventListener('click', closeConfig)
  el.fileClose.addEventListener('click', closeFile)
  el.fileView.addEventListener('click', (event) => { if (event.target === el.fileView) closeFile() })
  el.configSheet.addEventListener('click', (event) => { if (event.target === el.configSheet) closeConfig() })
  el.modelSelect.addEventListener('change', () => {
    const [provider, model] = el.modelSelect.value.split(':')
    if (provider && model) applyConfig({ model: { provider, model } })
  })
  el.permissionSelect.addEventListener('change', () => applyConfig({ permission: el.permissionSelect.value }))
  el.planToggle.addEventListener('change', () => applyConfig({ plan: el.planToggle.checked }))
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    if (!el.fileView.hidden) closeFile()
    else if (!el.configSheet.hidden) closeConfig()
    else if (!el.drawer.hidden) closeDrawer()
  })
  el.newSession.addEventListener('click', createSession)
  el.logout.addEventListener('click', async () => {
    try { await request('/api/logout', {}) } catch { /* ignore */ }
    location.reload()
  })
  el.composer.addEventListener('submit', send)
  el.input.addEventListener('input', autosize)
  el.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !isTouch()) {
      event.preventDefault()
      send(event)
    }
  })
  el.stop.addEventListener('click', stopTurn)
  el.log.addEventListener('scroll', () => {
    state.pinned = el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight < 60
    updateScrollJump()
    const now = Date.now()
    if (now - scrollSavedAt > 300) {
      scrollSavedAt = now
      rememberScrollTop(el.log.scrollTop)
    }
  })

  autosize()
  loadSessions().catch((error) => addStrip(error.message))
}

function isTouch() {
  return window.matchMedia('(pointer: coarse)').matches
}

/* ---------------- sessions ---------------- */

async function loadSessions() {
  const value = await request('/api/sessions')
  state.sessions = Array.isArray(value.items) ? value.items : []
  renderSessions()
  const wanted = state.sessionId || savedSessionId()
  if (wanted && state.sessions.some((session) => session.id === wanted)) {
    selectSession(wanted)
    return
  }
  if (wanted) {
    addStrip('The saved session is no longer available. Showing the latest one.')
    state.sessionId = null
  }
  if (!state.sessionId && state.sessions.length > 0) {
    const preferred = state.sessions.find((session) => session.running) || state.sessions[0]
    selectSession(preferred.id)
  } else if (state.sessionId) {
    updateMeta()
  }
}

function renderSessions() {
  el.sessionList.textContent = ''
  if (state.sessions.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'muted tiny'
    empty.style.padding = '10px 12px'
    empty.textContent = 'No sessions yet.'
    el.sessionList.append(empty)
    return
  }
  for (const session of state.sessions) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'session-item'
    button.setAttribute('aria-current', String(session.id === state.sessionId))

    const row1 = document.createElement('div')
    row1.className = 'row1'
    const name = document.createElement('span')
    name.textContent = titleOf(session)
    row1.append(name)
    if (session.running) {
      const dot = document.createElement('span')
      dot.className = 'dot'
      row1.append(dot)
    }

    const row2 = document.createElement('div')
    row2.className = 'row2'
    row2.textContent = subtitleOf(session)

    button.append(row1, row2)
    button.addEventListener('click', () => {
      selectSession(session.id)
      closeDrawer()
    })
    el.sessionList.append(button)
  }
}

function titleOf(session) {
  if (session.title) return session.title
  if (session.cwd) return baseName(session.cwd)
  return 'Untitled session'
}

function subtitleOf(session) {
  const parts = []
  if (session.cwd) parts.push(baseName(session.cwd))
  if (session.updatedAt) parts.push(relativeTime(session.updatedAt))
  if (session.running) parts.push('running')
  return parts.join(' · ') || session.id
}

function baseName(value) {
  const parts = String(value).split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || String(value)
}

function relativeTime(value) {
  const delta = Date.now() - Number(value)
  if (!Number.isFinite(delta)) return ''
  const minutes = Math.round(delta / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

async function createSession() {
  closeDrawer()
  try {
    const value = await request('/api/new-session', {})
    if (value?.sessionId) {
      await loadSessions()
      selectSession(value.sessionId)
      el.input.focus()
    }
  } catch (error) {
    addStrip(`Could not create a session: ${error.message}`)
  }
}

function selectSession(id) {
  if (state.sessionId === id && state.source) return
  state.sessionId = id
  rememberSession(id)
  state.seen.clear()
  state.lastSeq = 0
  state.tools.clear()
  // Wiping the transcript also drops the HITL cards, so the dedupe map must be
  // cleared too — otherwise the replayed `hitl/pending` for this session is
  // treated as a duplicate and the still-pending request never reappears.
  state.hitl.clear()
  state.earliestSeq = null
  state.historyMore = true
  updateHistoryButton()
  state.live = null
  state.liveText = ''
  state.running = false
  state.pending = []
  state.config = null
  state.queueItems = []
  if (el.queue) { el.queue.textContent = ''; el.queue.hidden = true }
  renderAttachments()
  closeConfig()
  el.log.textContent = ''
  // `textContent = ''` removes every child, including the static "load earlier"
  // control and the empty-state node, so both are put back.
  if (el.loadEarlier) el.log.append(el.loadEarlier)
  el.log.append(el.empty)
  el.empty.hidden = true
  setRunning(false)
  updateMeta()
  for (const button of el.sessionList.children) {
    button.setAttribute?.('aria-current', 'false')
  }
  renderSessions()
  openStream()
  refreshQueue()
  const restore = savedScrollTop()
  if (restore > 0) {
    setTimeout(() => {
      try { scrollLogTo(restore) } catch { /* ignore */ }
    }, 80)
  }
  updateScrollJump()
}

function updateMeta() {
  const session = state.sessions.find((entry) => entry.id === state.sessionId)
  el.title.textContent = session ? titleOf(session) : 'No session'
  el.meta.textContent = session ? subtitleOf(session) : ''
}

/* ---------------- stream ---------------- */

function openStream() {
  state.source?.close()
  setStatus('connecting')
  const source = new EventSource(`/api/stream?sessionId=${encodeURIComponent(state.sessionId)}`)
  state.source = source
  source.onopen = () => setStatus('live')
  source.onerror = () => setStatus('error')
  source.onmessage = (event) => {
    let frame
    try { frame = JSON.parse(event.data) } catch { return }
    handleFrame(frame)
  }
}

function handleFrame(frame) {
  if (!frame || typeof frame !== 'object') return
  if (frame.type === 'snapshot') {
    setStatus('live')
    if (typeof frame.cursor === 'number') state.lastSeq = Math.max(state.lastSeq, frame.cursor)
    for (const record of frame.records || []) {
      if (record?.type === 'event' && record.event) appendEvent(record.event)
    }
    updateHistoryButton()
    return
  }
  if (frame.type === 'event') {
    appendEvent(frame.event)
    return
  }
  if (frame.type === 'assistant-stream') {
    handleLive(frame.frame)
    return
  }
  if (frame.type === 'hitl/request') {
    renderHitl(frame)
    return
  }
  if (frame.type === 'hitl/pending') {
    reconcileHitl(frame.items || [])
    return
  }
  if (frame.type === 'hitl/settled') {
    settleHitl(frame.requestId)
    return
  }
  if (frame.type === 'remote-error') {
    addStrip(`${frame.code || 'error'}: ${frame.message || 'stream failed'}`)
    setStatus('error')
  }
}

function setStatus(value) {
  const labels = { live: 'live', connecting: 'connecting', error: 'offline', idle: 'idle' }
  el.status.dataset.state = value
  el.status.lastElementChild.textContent = labels[value] || value
}

/* ---------------- lightweight markdown ---------------- */

function renderInline(text) {
  const nodes = []
  const pattern = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\((https?:\/\/[^)\s]+)\))/g
  let last = 0
  let match
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(document.createTextNode(text.slice(last, match.index)))
    if (match[1]) {
      const code = document.createElement('code')
      code.textContent = match[1].slice(1, -1)
      nodes.push(code)
    } else if (match[2]) {
      const strong = document.createElement('strong')
      strong.textContent = match[2].slice(2, -2)
      nodes.push(strong)
    } else if (match[3]) {
      const em = document.createElement('em')
      em.textContent = match[3].slice(1, -1)
      nodes.push(em)
    } else if (match[4]) {
      const link = document.createElement('a')
      link.href = match[5]
      link.target = '_blank'
      link.rel = 'noreferrer noopener'
      link.textContent = match[4].slice(1, match[4].indexOf(']'))
      nodes.push(link)
    }
    last = pattern.lastIndex
  }
  if (last < text.length) nodes.push(document.createTextNode(text.slice(last)))
  return nodes
}

/**
 * Render a subset of Markdown as DOM nodes: fenced code, lists, headings,
 * inline code, bold, italics and links. Nodes are built rather than injected as
 * HTML, so model output can never introduce markup.
 */
function renderMarkdown(text) {
  const frag = document.createDocumentFragment()
  const lines = String(text ?? '').split('\n')
  let paragraph = []
  let list = null
  let code = null

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    const p = document.createElement('p')
    p.append(...renderInline(paragraph.join('\n')))
    frag.append(p)
    paragraph = []
  }
  const flushList = () => {
    if (list) frag.append(list)
    list = null
  }
  const flushCode = () => {
    if (!code) return
    const pre = document.createElement('pre')
    const block = document.createElement('code')
    if (code.lang) block.dataset.lang = code.lang
    block.textContent = code.lines.join('\n')
    pre.append(block)
    frag.append(pre)
    code = null
  }

  const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line)
  const isTableRule = (line) => /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(line)
  const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]

    const fence = /^\s*```(\S*)\s*$/.exec(line)
    if (fence) {
      if (code) { flushCode(); continue }
      flushParagraph()
      flushList()
      code = { lang: fence[1] || '', lines: [] }
      continue
    }
    if (code) { code.lines.push(line); continue }

    // A pipe row followed by a `|---|` rule is a table, not prose.
    if (isTableRow(line) && index + 1 < lines.length && isTableRule(lines[index + 1])) {
      flushParagraph()
      flushList()
      const header = splitRow(line)
      const rules = splitRow(lines[index + 1])
      const aligns = rules.map((cell) => {
        const left = cell.startsWith(':')
        const right = cell.endsWith(':')
        if (left && right) return 'center'
        if (right) return 'right'
        if (left) return 'left'
        return ''
      })
      index += 2
      const body = []
      while (index < lines.length && isTableRow(lines[index])) {
        body.push(splitRow(lines[index]))
        index++
      }
      index--
      frag.append(buildTable(header, aligns, body))
      continue
    }

    if (/^\s*$/.test(line)) { flushParagraph(); flushList(); continue }

    const heading = /^\s*(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      flushParagraph()
      flushList()
      const level = Math.min(6, heading[1].length + 2)
      const node = document.createElement(`h${level}`)
      node.append(...renderInline(heading[2]))
      frag.append(node)
      continue
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || ordered) {
      flushParagraph()
      const type = bulledType(bullet, ordered)
      if (!list || list.tagName !== type) {
        flushList()
        list = document.createElement(type)
      }
      const item = document.createElement('li')
      item.append(...renderInline((bullet || ordered)[1]))
      list.append(item)
      continue
    }

    flushList()
    paragraph.push(line)
  }

  flushCode()
  flushParagraph()
  flushList()
  return frag
}

function buildTable(header, aligns, body) {
  const table = document.createElement('table')
  const thead = document.createElement('thead')
  const headRow = document.createElement('tr')
  header.forEach((cell, index) => {
    const th = document.createElement('th')
    if (aligns[index]) th.style.textAlign = aligns[index]
    th.append(...renderInline(cell))
    headRow.append(th)
  })
  thead.append(headRow)
  table.append(thead)

  if (body.length > 0) {
    const tbody = document.createElement('tbody')
    for (const row of body) {
      const tr = document.createElement('tr')
      header.forEach((_, index) => {
        const td = document.createElement('td')
        if (aligns[index]) td.style.textAlign = aligns[index]
        td.append(...renderInline(row[index] ?? ''))
        tr.append(td)
      })
      tbody.append(tr)
    }
    table.append(tbody)
  }
  const wrap = document.createElement('div')
  wrap.className = 'table-wrap'
  wrap.append(table)
  return wrap
}

function bulledType(bullet, ordered) {
  return bullet ? 'UL' : 'OL'
}

function fillText(node, text) {
  node.textContent = ''
  node.append(renderMarkdown(text))
}

function appendEvent(event) {
  if (!event || typeof event.seq !== 'number' || state.seen.has(event.seq)) return
  state.seen.add(event.seq)
  state.lastSeq = Math.max(state.lastSeq, event.seq)
  if (state.earliestSeq === null || event.seq < state.earliestSeq) state.earliestSeq = event.seq

  const data = event.data || {}
  switch (event.type) {
    case 'user/message': {
      // Harness-injected context (runtime context, skill catalog, time context)
      // is also stored as user/message; only genuine prompts belong in the chat.
      const kind = data.source?.kind
      if (kind && kind !== 'user') break
      const content = data.content ?? data.message?.content
      const text = blocksText(content)
      const images = blocksImages(content)
      if (text || images.length > 0) addBubble('user', text, images)
      break
    }
    case 'session/title': {
      const title = typeof data.title === 'string' ? data.title.trim() : ''
      if (title) {
        el.title.textContent = title
        const session = state.sessions.find((entry) => entry.id === state.sessionId)
        if (session) session.title = title
      }
      break
    }
    case 'assistant/message': {
      clearLive()
      const text = blocksText(data.message?.content)
      const reasoning = blocksReasoning(data.message?.content)
  const images = blocksImages(data.message?.content)
      if (text || reasoning || images.length > 0) addAssistant(text, reasoning, data.interrupted === true, images)
      break
    }
    case 'assistant/attempt':
      clearLive()
      break
    case 'tool/call':
      addToolCall(data)
      break
    case 'tool/result':
      addToolResult(data)
      break
    case 'turn/start':
      setRunning(true)
      refreshQueue()
      break
    case 'turn/end': {
      setRunning(false)
      refreshQueue()
      const reason = data.reason || {}
      if (reason.kind === 'error') {
        addStrip(`Turn failed: ${reason.error?.message || reason.error?.code || 'unknown error'}`)
      } else if (reason.kind === 'aborted') {
        addNote('Stopped')
      } else if (reason.kind === 'max-tokens') {
        addNote('Stopped at the token limit')
      }
      break
    }
    default:
      break
  }
}

function blocksText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => (block && block.type === 'text' ? String(block.text ?? '') : ''))
    .join('')
}

function blocksReasoning(content) {
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => (block && block.type === 'reasoning' ? String(block.text ?? '') : ''))
    .join('\n')
}

function blocksImages(content) {
  if (!Array.isArray(content)) return []
  return content
    .filter((block) => block && block.type === 'image' && block.attachment && typeof block.attachment === 'object')
    .map((block) => block.attachment)
}

function attachmentUrl(ref) {
  if (!ref || typeof ref !== 'object' || typeof ref.attachmentId !== 'string') return ''
  return `/api/attachment?ref=${encodeURIComponent(JSON.stringify(ref))}`
}

function appendImages(container, refs) {
  if (!Array.isArray(refs) || refs.length === 0) return
  const row = document.createElement('div')
  row.className = 'msg-images'
  for (const ref of refs) {
    const src = attachmentUrl(ref)
    if (!src) continue
    const img = document.createElement('img')
    img.className = 'msg-image'
    img.loading = 'lazy'
    img.alt = ref?.name || 'image'
    img.src = src
    img.addEventListener('click', () => window.open(src, '_blank'))
    row.append(img)
  }
  if (row.children.length > 0) container.append(row)
}

function addBubble(kind, text, images) {
  const bubble = document.createElement('div')
  bubble.className = `bubble ${kind}`
  if (text) bubble.textContent = text
  appendImages(bubble, images)
  push(bubble)
  return bubble
}

function addAssistant(text, reasoning, interrupted, images) {
  // Reasoning renders as its own card in the transcript. Inside the bubble it
  // inherited the bubble's shrink-to-fit width and collapsed to a ~140px box
  // whose label wrapped onto two lines.
  if (reasoning) {
    const details = document.createElement('details')
    details.className = 'tool'
    const summary = document.createElement('summary')
    summary.textContent = 'Reasoning'
    const pre = document.createElement('pre')
    pre.textContent = reasoning
    details.append(summary, pre)
    push(details)
  }
  if (!text && !interrupted && (!Array.isArray(images) || images.length === 0)) return
  const bubble = document.createElement('div')
  bubble.className = 'bubble assistant'
  if (interrupted) bubble.classList.add('interrupted')
  if (text) {
    const body = document.createElement('div')
    fillText(body, text)
    bubble.append(body)
  }
  appendImages(bubble, images)
  if (interrupted) {
    const note = document.createElement('span')
    note.className = 'label'
    note.textContent = 'interrupted'
    bubble.append(note)
  }
  push(bubble)
}

function addToolCall(data) {
  const name = String(data.name || 'tool')
  let args = null
  try {
    args = JSON.parse(data.arguments || '{}')
  } catch {
    args = null
  }
  const hint = args && typeof args === 'object'
    ? (args.command || args.path || args.file_path || args.query || args.description || '')
    : String(data.arguments || '')
  const details = document.createElement('details')
  details.className = 'tool'

  const summary = document.createElement('summary')
  const toolName = document.createElement('span')
  toolName.className = 'tool-name'
  toolName.textContent = name
  const toolHint = document.createElement('span')
  toolHint.className = 'tool-hint'
  toolHint.textContent = String(hint).replace(/\s+/g, ' ').slice(0, 120)
  summary.append('⚙', toolName, toolHint)

  const body = document.createElement('div')
  body.className = 'tool-body'
  renderToolArgs(body, args, data.arguments)
  details.append(summary, body)

  if (data.callId) state.tools.set(data.callId, details)
  push(details)
}

/**
 * Render tool arguments by meaning instead of dumping JSON: the description as
 * prose, the command (or path/query) as its own block, and the rest as a single
 * key/value grid.
 */
function renderToolArgs(container, args, raw) {
  if (!args || typeof args !== 'object') {
    const pre = document.createElement('pre')
    pre.textContent = String(raw ?? '')
    container.append(pre)
    return
  }

  const shown = new Set()
  if (typeof args.description === 'string' && args.description.trim()) {
    const p = document.createElement('p')
    p.className = 'tool-desc'
    p.textContent = args.description
    container.append(p)
    shown.add('description')
  }

  for (const key of ['command', 'cmd', 'path', 'file_path', 'query', 'url', 'pattern']) {
    const value = args[key]
    if (typeof value !== 'string' || value.trim() === '') continue
    const pre = document.createElement('pre')
    pre.className = 'tool-command'
    pre.textContent = value
    container.append(pre)
    if (key === 'path' || key === 'file_path') {
      const open = document.createElement('button')
      open.type = 'button'
      open.className = 'file-link'
      open.textContent = 'Open file'
      open.addEventListener('click', () => openFile(value))
      container.append(open)
    }
    shown.add(key)
  }

  const rows = Object.entries(args).filter(([key]) => !shown.has(key))
  if (rows.length > 0) {
    const dl = document.createElement('dl')
    dl.className = 'tool-args'
    for (const [key, value] of rows) {
      const dt = document.createElement('dt')
      dt.textContent = key
      const dd = document.createElement('dd')
      dd.textContent = typeof value === 'string' ? value : JSON.stringify(value)
      dl.append(dt, dd)
    }
    container.append(dl)
  }
}

function addToolResult(data) {
  const details = data.message?.toolCallId ? state.tools.get(data.message.toolCallId) : undefined
  const output = blocksText(data.message?.content)
  const failed = Boolean(data.error) || data.message?.isError === true
  const target = details || document.createElement('details')

  if (!details) {
    target.className = 'tool'
    const summary = document.createElement('summary')
    summary.textContent = 'tool result'
    target.append(summary)
    push(target)
  }
  if (failed) target.classList.add('error')

  const pre = document.createElement('pre')
  if (failed && data.error) {
    pre.textContent = `${data.error.name || 'error'}: ${data.error.reason || data.error.code || ''}`
    if (output) pre.textContent += `\n\n${output}`
  } else {
    pre.textContent = output || '(no output)'
  }
  const body = document.createElement('div')
  body.className = 'tool-body'
  body.append(pre)
  target.append(body)
}

function addNote(text) {
  const note = document.createElement('div')
  note.className = 'note'
  note.textContent = text
  push(note)
}

function addStrip(text) {
  const strip = document.createElement('div')
  strip.className = 'strip'
  strip.textContent = text
  push(strip)
}

/* ---------------- human in the loop ---------------- */

function renderHitl(item) {
  if (!item?.requestId || state.hitl.has(item.requestId)) return
  const card = document.createElement('div')
  card.className = `bubble hitl ${item.kind === 'question' ? 'question' : 'approval'}`
  card.dataset.request = item.requestId

  const label = document.createElement('span')
  label.className = 'label'
  label.textContent = item.kind === 'question' ? 'The agent needs an answer' : 'Waiting for approval'
  card.append(label)

  if (item.kind === 'question') buildQuestionCard(card, item)
  else buildApprovalCard(card, item)

  state.hitl.set(item.requestId, card)
  push(card)
  if (state.pinned) requestAnimationFrame(() => { el.log.scrollTop = el.log.scrollHeight })
}

function approvalText(item) {
  const display = item.displayReason
  if (display && typeof display === 'object') {
    const tag = (navigator.language || 'en').toLowerCase()
    const base = tag.split('-')[0]
    return display[tag] || display[base] || display.en || item.reason || ''
  }
  if (typeof display === 'string' && display) return display
  return item.reason || ''
}

function buildApprovalCard(card, item) {
  const body = document.createElement('div')
  body.className = 'hitl-body'
  body.textContent = approvalText(item) || `Allow this operation: ${item.toolName || 'a tool'}`
  card.append(body)

  const actions = document.createElement('div')
  actions.className = 'hitl-actions'
  const reject = document.createElement('button')
  reject.type = 'button'
  reject.className = 'ghost-button'
  reject.textContent = 'Reject'
  const allow = document.createElement('button')
  allow.type = 'button'
  allow.className = 'primary-button'
  allow.textContent = 'Allow once'
  actions.append(reject, allow)
  card.append(actions)

  const decide = async (decision) => {
    reject.disabled = true
    allow.disabled = true
    card.dataset.state = 'answering'
    try {
      await request('/api/approval', { requestId: item.requestId, decision })
    } catch (error) {
      card.dataset.state = 'error'
      reject.disabled = false
      allow.disabled = false
      addStrip(`Could not answer: ${error.message}`)
    }
  }
  reject.addEventListener('click', () => decide('deny'))
  allow.addEventListener('click', () => decide('allow'))
}

function buildQuestionCard(card, item) {
  const questions = Array.isArray(item.questions) ? item.questions : []
  const chosen = new Map()

  for (const question of questions) {
    const block = document.createElement('div')
    block.className = 'hitl-question'

    const text = document.createElement('p')
    text.textContent = question.question || question.label || ''
    if (text.textContent) block.append(text)

    const row = document.createElement('div')
    row.className = 'hitl-options'
    const custom = document.createElement('input')
    custom.type = 'text'
    custom.className = 'hitl-custom'
    custom.placeholder = 'Or type an answer'

    const buttons = []
    for (const option of Array.isArray(question.options) ? question.options : []) {
      const value = typeof option === 'string' ? option : String(option?.label ?? option?.value ?? '')
      if (!value) continue
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'hitl-option'
      button.textContent = value
      button.addEventListener('click', () => {
        for (const other of buttons) other.dataset.selected = String(other === button)
        custom.value = ''
        chosen.set(question.id, { id: question.id, selected: [value] })
        refreshSend()
      })
      buttons.push(button)
      row.append(button)
    }

    custom.addEventListener('input', () => {
      if (!custom.value.trim()) return
      for (const button of buttons) button.dataset.selected = 'false'
      chosen.set(question.id, { id: question.id, selected: [], custom: custom.value })
      refreshSend()
    })

    block.append(row, custom)
    card.append(block)
  }

  const actions = document.createElement('div')
  actions.className = 'hitl-actions'
  const send = document.createElement('button')
  send.type = 'button'
  send.className = 'primary-button'
  send.textContent = 'Send answer'
  send.disabled = true
  actions.append(send)
  card.append(actions)

  function refreshSend() {
    send.disabled = !questions.every((question) => chosen.has(question.id))
  }

  send.addEventListener('click', async () => {
    send.disabled = true
    card.dataset.state = 'answering'
    try {
      await request('/api/answer', {
        requestId: item.requestId,
        answers: questions.map((question) => chosen.get(question.id)),
      })
    } catch (error) {
      card.dataset.state = 'error'
      send.disabled = false
      addStrip(`Could not answer: ${error.message}`)
    }
  })
}

/**
 * The replay that follows every (re)connect is authoritative: cards for
 * requests the Host no longer holds are dropped, which is what clears a card
 * answered while this page was disconnected.
 */
function reconcileHitl(items) {
  const live = new Set()
  for (const item of items) if (item?.requestId) live.add(item.requestId)
  for (const [requestId, card] of [...state.hitl]) {
    if (live.has(requestId)) continue
    card.remove()
    state.hitl.delete(requestId)
  }
  for (const item of items) renderHitl(item)
}

function settleHitl(requestId) {
  const card = state.hitl.get(String(requestId ?? ''))
  if (!card) return
  card.dataset.state = 'settled'
  for (const button of card.querySelectorAll('button')) button.disabled = true
  const label = card.querySelector('.label')
  if (label) label.textContent = 'Answered'
}

/**
 * Scroll the transcript without the CSS `scroll-behavior: smooth` animation.
 * An animated jump emits scroll events mid-flight, which the pinned check reads
 * as "the user scrolled up" and then stops following new content.
 */
function scrollLogTo(top) {
  const previous = el.log.style.scrollBehavior
  el.log.style.scrollBehavior = 'auto'
  el.log.scrollTop = top
  el.log.style.scrollBehavior = previous
}

function push(node) {
  el.empty.hidden = true
  el.log.append(node)
  if (state.pinned && !renderingHistory) {
    requestAnimationFrame(() => {
      scrollLogTo(el.log.scrollHeight)
      updateScrollJump()
    })
  } else {
    updateScrollJump()
  }
}

/* ---------------- queued messages ---------------- */

function renderQueue(items) {
  state.queueItems = items
  if (!el.queue) return
  el.queue.textContent = ''
  el.queue.hidden = items.length === 0

  for (const item of items) {
    const row = document.createElement('div')
    row.className = 'queue-item'

    const text = document.createElement('span')
    text.className = 'queue-text'
    text.textContent = item.text || '(attachment)'
    row.append(text)

    if (item.placement === 'queued' && state.running) {
      const steer = document.createElement('button')
      steer.type = 'button'
      steer.className = 'queue-action'
      steer.textContent = 'Steer'
      steer.addEventListener('click', () => queueAction(item.id, 'steer'))
      row.append(steer)
    }

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'queue-action'
    remove.setAttribute('aria-label', 'Remove queued message')
    remove.textContent = '×'
    remove.addEventListener('click', () => queueAction(item.id, 'remove'))
    row.append(remove)

    el.queue.append(row)
  }
}

async function refreshQueue() {
  if (!state.sessionId) return
  try {
    const value = await request(`/api/state?sessionId=${encodeURIComponent(state.sessionId)}`)
    if (value && state.sessionId) renderQueue(Array.isArray(value.queue) ? value.queue : [])
  } catch { /* queue state is best-effort */ }
}

async function queueAction(itemId, kind) {
  if (!state.sessionId) return
  try {
    await request('/api/queue', { sessionId: state.sessionId, itemId, action: { kind } })
  } catch (error) {
    addStrip(`Queue update failed: ${error.message}`)
  }
  await refreshQueue()
}

/* ---------------- scroll jumps ---------------- */

function updateScrollJump() {
  if (!el.scrollJump) return
  const log = el.log
  const fromBottom = log.scrollHeight - log.scrollTop - log.clientHeight
  const showUp = log.scrollTop > 200
  const showDown = fromBottom > 80
  el.scrollJump.hidden = !(showUp || showDown)
  if (el.scrollTopBtn) el.scrollTopBtn.hidden = !showUp
  if (el.scrollBottomBtn) el.scrollBottomBtn.hidden = !showDown
}

/* ---------------- history paging ---------------- */

function updateHistoryButton() {
  if (!el.loadEarlier) return
  const more = state.historyMore !== false && Number.isFinite(state.earliestSeq) && state.earliestSeq > 1
  el.loadEarlier.hidden = !more || !state.sessionId
}

async function loadEarlier() {
  if (!state.sessionId || !el.loadEarlier || el.loadEarlier.disabled) return
  if (!Number.isFinite(state.earliestSeq)) return

  el.loadEarlier.disabled = true
  const sessionId = state.sessionId
  try {
    const page = await request(
      `/api/history?sessionId=${encodeURIComponent(sessionId)}&before=${state.earliestSeq}&max=60`,
    )
    if (sessionId !== state.sessionId) return

    const older = (page.records || []).filter((record) => record?.type === 'event' && record.event)
    if (older.length === 0) {
      state.historyMore = false
      updateHistoryButton()
      return
    }

    const log = el.log
    const anchor = el.loadEarlier.nextSibling
    const heightBefore = log.scrollHeight
    const topBefore = log.scrollTop

    // Render into a detached holder so the existing renderers append somewhere
    // harmless, then splice the block in above the current transcript.
    const holder = document.createElement('div')
    const realLog = el.log
    el.log = holder
    renderingHistory = true
    try {
      for (const record of older) appendEvent(record.event)
    } finally {
      renderingHistory = false
      el.log = realLog
    }

    const fragment = document.createDocumentFragment()
    while (holder.firstChild) fragment.append(holder.firstChild)
    log.insertBefore(fragment, anchor)

    scrollLogTo(topBefore + (log.scrollHeight - heightBefore))
    if (page.hasMore === false) state.historyMore = false
    updateHistoryButton()
    updateScrollJump()  } catch (error) {
    addStrip(`Could not load earlier messages: ${error.message}`)
  } finally {
    el.loadEarlier.disabled = false
  }
}

/* ---------------- live assistant stream ---------------- */

function handleLive(frame) {
  if (!frame || typeof frame !== 'object') return
  if (frame.type === 'start') {
    clearLive()
    state.live = document.createElement('div')
    state.live.className = 'bubble assistant live'
    state.liveText = ''
    const body = document.createElement('div')
    body.className = 'live-body'
    state.live.append(body)
    push(state.live)
    return
  }
  if (frame.type === 'chunk') {
    const chunk = frame.chunk || {}
    if (!state.live) return
    const body = state.live.querySelector('.live-body')
    if (chunk.type === 'text-delta') {
      state.liveText += String(chunk.text ?? '')
      body.textContent = state.liveText
    } else if (chunk.type === 'block-end' && chunk.block?.type === 'text') {
      state.liveText = String(chunk.block.text ?? '')
      body.textContent = state.liveText
    }
    if (state.pinned) requestAnimationFrame(() => { el.log.scrollTop = el.log.scrollHeight })
    return
  }
  if (frame.type === 'end') {
    const live = state.live
    setTimeout(() => {
      if (state.live === live) clearLive()
    }, 800)
  }
}

function clearLive() {
  if (state.live) {
    state.live.remove()
    state.live = null
    state.liveText = ''
  }
}

/* ---------------- actions ---------------- */

function setRunning(value) {
  state.running = value
  el.stop.hidden = !value
  el.send.disabled = false
  // The delivery mode only matters while a turn is open: the next message is
  // either queued behind it or steered into it.
  if (el.modeRow) el.modeRow.hidden = !value
  if (!value) {
    state.mode = 'queue'
    for (const button of el.modeSwitch?.querySelectorAll('button[data-mode]') ?? []) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === 'queue'))
    }
  }
  // Steering is only offered while the turn is open, so re-render the queue.
  renderQueue(state.queueItems)
}

async function send(event) {
  event?.preventDefault()
  const text = el.input.value.trim()
  if (!state.sessionId) return
  const ready = state.pending.filter((entry) => entry.state === 'ready' && entry.attachment)
  if (!text && ready.length === 0) return
  const attachments = ready.map((entry) => ({ type: entry.kind, attachment: entry.attachment }))
  el.input.value = ''
  autosize()
  try {
    await request('/api/prompt', { sessionId: state.sessionId, text, attachments, mode: state.mode })
    if (ready.length > 0) {
      state.pending = state.pending.filter((entry) => entry.state !== 'ready')
      renderAttachments()
    }
    if (state.pinned) requestAnimationFrame(() => { el.log.scrollTop = el.log.scrollHeight })
    refreshQueue()
  } catch (error) {
    el.input.value = text
    autosize()
    addStrip(`Could not send: ${error.message}`)
  }
}

async function stopTurn() {
  if (!state.sessionId) return
  el.stop.disabled = true
  try {
    await request('/api/cancel', { sessionId: state.sessionId })
  } catch (error) {
    addStrip(`Could not stop: ${error.message}`)
  } finally {
    el.stop.disabled = false
  }
}

/* ---------------- attachments ---------------- */

const MAX_FILE_BYTES = 25 * 1024 * 1024

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const step = 0x8000
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + step))
  }
  return btoa(binary)
}

async function uploadFile(file) {
  if (!state.sessionId || !file) return
  if (file.size <= 0) {
    addStrip(`${file.name || 'That file'} is empty`)
    return
  }
  if (file.size > MAX_FILE_BYTES) {
    addStrip(`${file.name} is larger than 25 MB`)
    return
  }

  const entry = { name: file.name, size: file.size, state: 'uploading', progress: 0 }
  state.pending.push(entry)
  renderAttachments()

  try {
    const started = await request('/api/upload/init', {
      sessionId: state.sessionId,
      name: file.name,
      size: file.size,
      mediaType: file.type || 'application/octet-stream',
    })
    const chunkSize = Math.max(1, Number(started.chunkSize) || 1024 * 1024)
    for (let index = 0, offset = 0; offset < file.size; index++, offset += chunkSize) {
      const slice = file.slice(offset, Math.min(offset + chunkSize, file.size))
      await request('/api/upload/chunk', {
        uploadId: started.uploadId,
        index,
        data: toBase64(await slice.arrayBuffer()),
      })
      entry.progress = Math.min(1, (offset + slice.size) / file.size)
      renderAttachments()
    }
    const committed = await request('/api/upload/commit', { uploadId: started.uploadId })
    entry.attachment = committed.attachment
    entry.kind = committed.kind === 'image' ? 'image' : 'file'
    entry.state = 'ready'
    entry.progress = 1
  } catch (error) {
    entry.state = 'error'
    entry.error = error.message
    addStrip(`Upload failed for ${file.name}: ${error.message}`)
  }
  renderAttachments()
}

function renderAttachments() {
  const entries = state.pending
  el.attachmentsEl.hidden = entries.length === 0
  el.attachmentsEl.textContent = ''

  for (const entry of entries) {
    const chip = document.createElement('span')
    chip.className = 'chip'
    chip.dataset.state = entry.state

    const name = document.createElement('span')
    name.className = 'chip-name'
    name.textContent = entry.name

    const meta = document.createElement('span')
    meta.className = 'chip-meta'
    meta.textContent = entry.state === 'uploading'
      ? `${Math.round(entry.progress * 100)}%`
      : entry.state === 'error' ? 'failed' : formatBytes(entry.size)

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'chip-remove'
    remove.setAttribute('aria-label', `Remove ${entry.name}`)
    remove.textContent = '×'
    remove.addEventListener('click', () => {
      state.pending = state.pending.filter((item) => item !== entry)
      renderAttachments()
    })

    chip.append(name, meta, remove)
    el.attachmentsEl.append(chip)
  }

  el.attach.disabled = !state.sessionId || entries.some((entry) => entry.state === 'uploading')
}

/* ---------------- session settings ---------------- */

function openConfig() {
  if (!state.sessionId) return
  el.configSheet.hidden = false
  loadConfig().catch((error) => { el.configStatus.textContent = `Could not load settings: ${error.message}` })
}

function closeConfig() {
  el.configSheet.hidden = true
}

/* ---------------- file preview ---------------- */

const IMAGE_FILE = /\.(png|jpe?g|webp|gif)$/i
const PDF_FILE = /\.pdf$/i

function closeFile() {
  el.fileView.hidden = true
  el.fileBody.textContent = ''
}

async function openFile(filePath) {
  if (!state.sessionId || !filePath) return
  el.fileView.hidden = false
  el.fileTitle.textContent = filePath
  el.fileBody.textContent = ''

  const query = `sessionId=${encodeURIComponent(state.sessionId)}&path=${encodeURIComponent(filePath)}`

  if (IMAGE_FILE.test(filePath)) {
    const img = document.createElement('img')
    img.src = `/api/file?${query}&raw=1`
    img.alt = filePath
    el.fileBody.append(img)
    return
  }

  if (PDF_FILE.test(filePath)) {
    // Rendered by the platform viewer rather than dumped as text.
    const frame = document.createElement('iframe')
    frame.src = `/api/file?${query}&raw=1`
    frame.title = filePath
    el.fileBody.append(frame)
    return
  }

  const note = document.createElement('p')
  note.textContent = 'Loading…'
  el.fileBody.append(note)
  try {
    const value = await request(`/api/file?${query}`)
    el.fileBody.textContent = ''
    const pre = document.createElement('pre')
    pre.textContent = value?.text ?? ''
    el.fileBody.append(pre)
    if (value?.name) el.fileTitle.textContent = value.name
  } catch (error) {
    el.fileBody.textContent = `Could not open this file: ${error.message}`
  }
}

async function loadConfig() {
  el.configStatus.textContent = 'Loading…'
  const config = await request(`/api/config?sessionId=${encodeURIComponent(state.sessionId)}`)
  state.config = config
  renderConfig(config)
}

function renderConfig(config) {
  const groups = Array.isArray(config?.models) ? config.models.filter((group) => group.models?.length > 0) : []
  el.modelSelect.textContent = ''
  if (groups.length === 0) {
    const option = document.createElement('option')
    option.value = ''
    option.textContent = 'No models available'
    el.modelSelect.append(option)
    el.modelSelect.disabled = true
  } else {
    el.modelSelect.disabled = false
    for (const group of groups) {
      const optgroup = document.createElement('optgroup')
      optgroup.label = group.name || group.provider
      for (const model of group.models) {
        const option = document.createElement('option')
        option.value = `${group.provider}:${model.id}`
        option.textContent = model.name || model.id
        optgroup.append(option)
      }
      el.modelSelect.append(optgroup)
    }
    const current = config?.model ? `${config.model.provider}:${config.model.model}` : ''
    if (current) el.modelSelect.value = current
    if (!el.modelSelect.value) el.modelSelect.selectedIndex = 0
  }

  const options = config?.permission?.catalog?.options ?? []
  el.permissionSelect.textContent = ''
  if (options.length === 0) {
    const option = document.createElement('option')
    option.value = ''
    option.textContent = config?.live === false ? 'Available once the session runs' : 'No permission presets'
    el.permissionSelect.append(option)
    el.permissionSelect.disabled = true
  } else {
    el.permissionSelect.disabled = false
    for (const item of options) {
      const option = document.createElement('option')
      option.value = item.value
      option.textContent = item.name
      if (item.description) option.title = item.description
      el.permissionSelect.append(option)
    }
    const current = config?.permission?.current || config?.permission?.catalog?.defaultPreset || ''
    if (current) el.permissionSelect.value = current
  }

  const planAvailable = config?.plan && typeof config.plan.active === 'boolean'
  el.planToggle.disabled = !planAvailable
  el.planToggle.checked = config?.plan?.active === true
  el.configStatus.textContent = planAvailable ? '' : 'Plan mode appears once the session is running.'
}

async function applyConfig(patch) {
  if (!state.sessionId) return
  el.configStatus.textContent = 'Saving…'
  try {
    const result = await request('/api/config', { sessionId: state.sessionId, ...patch })
    if (result?.ok === false) throw new Error((result.failures || []).join('; ') || 'rejected')
    await loadConfig()
    el.configStatus.textContent = 'Saved'
    setTimeout(() => {
      if (el.configStatus.textContent === 'Saved') el.configStatus.textContent = ''
    }, 1500)
  } catch (error) {
    el.configStatus.textContent = `Could not apply: ${error.message}`
    await loadConfig().catch(() => {})
  }
}

function autosize() {
  el.input.style.height = 'auto'
  el.input.style.height = `${Math.min(el.input.scrollHeight, window.innerHeight * 0.4)}px`
}

/* ---------------- drawer ---------------- */

function toggleDrawer() {
  if (el.drawer.hidden) openDrawer()
  else closeDrawer()
}

function openDrawer() {
  el.drawer.hidden = false
  el.scrim.hidden = false
  el.menu.setAttribute('aria-expanded', 'true')
  loadSessions().catch(() => {})
}

function closeDrawer() {
  el.drawer.hidden = true
  el.scrim.hidden = true
  el.menu.setAttribute('aria-expanded', 'false')
}

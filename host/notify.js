import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import net from 'node:net'
import tls from 'node:tls'

/**
 * Out-of-band notifications.
 *
 * A phone browser cannot receive Web Push without HTTPS, a home-screen web app
 * and a push sender, so the Host can instead push to an existing app the user
 * already trusts. ntfy is the supported channel: it accepts a JSON publish with
 * action buttons, so a notification can carry "Allow once" / "Reject" links
 * that hit this Host directly.
 *
 * Action links are signed with the same secret that protects the pairing
 * cookie, and are only honoured while the request is still pending, so a stale
 * or forwarded notification can never replay a decision.
 */

const DEFAULT_EVENTS = ['approval', 'question']
const TIMEOUT_MS = 8000

export function signAction(secret, requestId, decision) {
  return createHmac('sha256', secret).update(`${requestId}:${decision}`).digest('base64url')
}

export function verifyAction(secret, requestId, decision, signature) {
  if (typeof signature !== 'string' || signature === '') return false
  const expected = signAction(secret, requestId, decision)
  const actual = Buffer.from(signature, 'utf8')
  const wanted = Buffer.from(expected, 'utf8')
  if (actual.length !== wanted.length) return false
  return timingSafeEqual(actual, wanted)
}

export function normalizeNotify(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const kind = ['ntfy', 'webhook', 'mailgun', 'smtp'].includes(source.kind) ? source.kind : 'none'
  const events = Array.isArray(source.events) && source.events.length > 0
    ? source.events.filter((entry) => typeof entry === 'string')
    : DEFAULT_EVENTS
  const headers = {}
  if (source.headers && typeof source.headers === 'object' && !Array.isArray(source.headers)) {
    for (const [key, value] of Object.entries(source.headers)) {
      if (typeof value === 'string' && /^[A-Za-z0-9-]+$/.test(key)) headers[key] = value
    }
  }
  const apiUrl = typeof source.apiUrl === 'string' && source.apiUrl.trim() !== ''
    ? source.apiUrl.trim().replace(/\/+$/, '')
    : 'https://api.mailgun.net'
  return {
    kind,
    url: typeof source.url === 'string' ? source.url.trim() : '',
    topic: typeof source.topic === 'string' ? source.topic.trim() : '',
    token: typeof source.token === 'string' ? source.token.trim() : '',
    headers,
    baseUrl: typeof source.baseUrl === 'string' ? source.baseUrl.trim().replace(/\/+$/, '') : '',
    events,
    priority: Number.isInteger(source.priority) ? source.priority : 4,
    // Direct mail: the Host talks to the mail provider itself, so no relay
    // service has to be deployed or maintained just to forward a notice.
    to: typeof source.to === 'string' ? source.to.trim() : '',
    from: typeof source.from === 'string' ? source.from.trim() : '',
    domain: typeof source.domain === 'string' ? source.domain.trim() : '',
    apiKey: typeof source.apiKey === 'string' ? source.apiKey.trim() : '',
    apiUrl,
    // Direct SMTP: still no third party beyond the mailbox itself.
    smtpHost: typeof source.smtpHost === 'string' ? source.smtpHost.trim() : '',
    smtpPort: Number.isInteger(source.smtpPort) && source.smtpPort > 0 ? source.smtpPort : 465,
    smtpUser: typeof source.smtpUser === 'string' ? source.smtpUser.trim() : '',
    smtpPass: typeof source.smtpPass === 'string' ? source.smtpPass : '',
  }
}

export function createNotifier({ config, secret, log = console } = {}) {
  const settings = normalizeNotify(config)
  const events = new Set(settings.events)

  const enabled = settings.kind === 'mailgun'
    ? Boolean(settings.to && settings.domain && settings.apiKey)
    : settings.kind === 'smtp'
      ? Boolean(settings.to && settings.smtpHost && settings.smtpUser && settings.smtpPass)
      : (settings.kind === 'ntfy' || settings.kind === 'webhook') && /^https?:\/\//i.test(settings.url)

  function wants(event) {
    return enabled && events.has(event)
  }

  /**
   * Build the signed action links when a public base URL is configured. The
   * plain page link is always last: a decision link stops working once the
   * request is answered elsewhere, and the page still shows the current state.
   */
  function linksFor(requestId) {
    if (!settings.baseUrl) return undefined
    const link = (decision, label) => {
      const signature = signAction(secret, requestId, decision)
      const params = new URLSearchParams({ r: requestId, d: decision, t: signature })
      return { decision, label, url: `${settings.baseUrl}/api/notify/action?${params.toString()}` }
    }
    return [
      link('allow', 'Allow once'),
      link('deny', 'Reject'),
      { decision: 'open', label: 'Open the page', url: settings.baseUrl },
    ]
  }

  function ntfyBody(payload) {
    const body = {}
    if (payload.title) body.title = payload.title
    if (payload.message) body.message = payload.message
    if (Number.isInteger(settings.priority)) body.priority = settings.priority
    if (Array.isArray(payload.tags) && payload.tags.length > 0) body.tags = payload.tags
    const links = payload.links
    if (Array.isArray(links) && links.length > 0) {
      body.actions = links.map((link) => ({ action: 'view', label: link.label, url: link.url, clear: true }))
    }
    return body
  }

  /**
   * ntfy only parses a structured publish when the request goes to the server
   * root and carries `topic` in the body. Posting JSON to `/<topic>` silently
   * turns the whole document into the notification text, so the topic is split
   * out of the configured URL here.
   */
  function ntfyTarget() {
    if (settings.topic) return { endpoint: settings.url, topic: settings.topic }
    try {
      const parsed = new URL(settings.url)
      const segments = parsed.pathname.split('/').filter(Boolean)
      const topic = segments.pop() || ''
      const prefix = segments.length > 0 ? `/${segments.join('/')}` : ''
      return { endpoint: `${parsed.origin}${prefix}`, topic }
    } catch {
      return { endpoint: settings.url, topic: '' }
    }
  }

  function webhookBody(payload) {
    const body = {
      source: 'dsh-remote-control',
      type: payload.kind ?? 'approval',
      title: payload.title ?? '',
      message: payload.message ?? '',
      sentAt: new Date().toISOString(),
    }
    if (payload.requestId) body.requestId = payload.requestId
    if (payload.sessionId) body.sessionId = payload.sessionId
    if (payload.toolName) body.toolName = payload.toolName
    if (Array.isArray(payload.links) && payload.links.length > 0) {
      body.actions = payload.links.map((link) => ({ label: link.label, decision: link.decision, url: link.url }))
    }
    return body
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
    ))
  }

  /**
   * Direct mail from the Host: the recipient, sender and provider key all live
   * in the Host's own settings, so no external service has to store or forward
   * the notification. Action buttons are the same signed links as the other
   * channels.
   */
  function emailMessage(payload) {
    const actions = Array.isArray(payload.links) ? payload.links : []
    const subject = `[DSH] ${payload.title || 'notification'}`
    const lines = [payload.message || '']
    if (payload.toolName) lines.push(`Tool: ${payload.toolName}`)
    if (actions.length > 0) lines.push('', ...actions.map((link) => `${link.label}: ${link.url}`))
    const buttons = actions
      .map((link) => `<a href="${escapeHtml(link.url)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 16px;border-radius:8px;background:#3b6cf6;color:#ffffff;text-decoration:none;font-weight:600">${escapeHtml(link.label)}</a>`)
      .join('')
    const html = [
      '<div style="font:16px system-ui,-apple-system,Segoe UI,sans-serif;color:#1b1f27;background:#f6f7fb;padding:18px;border-radius:12px">',
      `<h2 style="margin:0 0 8px;font-size:18px">${escapeHtml(payload.title || 'DSH notification')}</h2>`,
      `<p style="margin:0 0 12px;white-space:pre-wrap">${escapeHtml(payload.message || '')}</p>`,
      payload.toolName ? `<p style="margin:0 0 12px;color:#5b6472;font-size:13px">Tool: ${escapeHtml(payload.toolName)}</p>` : '',
      buttons,
      '</div>',
    ].join('')
    return { subject, text: lines.join('\n'), html }
  }

  async function sendMailgun(payload) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    timer.unref?.()
    try {
      const message = emailMessage(payload)
      const from = settings.from && settings.from.includes('@') ? settings.from : `postmaster@${settings.domain}`
      const form = new URLSearchParams({
        from,
        to: settings.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      })
      const response = await fetch(`${settings.apiUrl}/v3/${settings.domain}/messages`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`api:${settings.apiKey}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
        signal: controller.signal,
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        log.warn?.(`[remote-control] mailgun send failed with HTTP ${response.status}: ${detail.slice(0, 200)}`)
        return { ok: false, error: `mailgun-http-${response.status}` }
      }
      return { ok: true }
    } catch (error) {
      log.warn?.(`[remote-control] mailgun send failed: ${error?.message || error}`)
      return { ok: false, error: error?.message || String(error) }
    } finally {
      clearTimeout(timer)
    }
  }

  /** Minimal SMTP client: greeting, EHLO, optional STARTTLS, AUTH LOGIN, DATA. */
  function smtpReader(socket) {
    let lines = []
    let partial = ''
    let wake = null
    socket.on('data', (chunk) => {
      const parts = (partial + chunk.toString('utf8')).split('\r\n')
      partial = parts.pop() ?? ''
      for (const line of parts) lines.push(line)
      if (wake) { const fn = wake; wake = null; fn() }
    })
    return async function readReply(timeoutMs = 20000) {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const end = lines.findIndex((line) => /^\d{3} /.test(line))
        if (end !== -1) {
          const reply = lines.slice(0, end + 1)
          lines = lines.slice(end + 1)
          return { code: Number(reply[end].slice(0, 3)), lines: reply }
        }
        if (Date.now() > deadline) throw new Error('smtp reply timeout')
        await new Promise((resolve) => { wake = resolve; setTimeout(resolve, 200) })
      }
    }
  }

  function mimeMessage(message, from, to) {
    const boundary = `dsh-${randomBytes(8).toString('hex')}`
    const encodeHeader = (value) => (/^[\x20-\x7e]*$/.test(value)
      ? value
      : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`)
    const chunked = (text) => Buffer.from(text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n')
    return [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${encodeHeader(message.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomBytes(12).toString('hex')}@dsh-remote-control>`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      chunked(message.text),
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      chunked(message.html),
      `--${boundary}--`,
      '',
    ].join('\r\n')
  }

  async function sendSmtp(payload) {
    const message = emailMessage(payload)
    const from = settings.from && settings.from.includes('@') ? settings.from : settings.smtpUser
    const address = /^[^@\s]+@[^@\s]+$/
    if (!address.test(settings.to) || !address.test(from)) return { ok: false, error: 'smtp-bad-address' }

    const port = settings.smtpPort
    let socket
    try {
      socket = port === 465
        ? tls.connect({ host: settings.smtpHost, port, servername: settings.smtpHost })
        : net.connect({ host: settings.smtpHost, port })
      socket.setTimeout(25000)
      await new Promise((resolve, reject) => {
        socket.once(port === 465 ? 'secureConnect' : 'connect', resolve)
        socket.once('error', reject)
      })

      let read = smtpReader(socket)
      const send = (line) => socket.write(`${line}\r\n`)
      const ehlo = () => { send('EHLO dsh-remote-control'); return read() }

      let reply = await read()
      if (reply.code !== 220) throw new Error(`smtp greeting ${reply.code}`)
      reply = await ehlo()
      if (reply.code !== 250) throw new Error(`smtp ehlo ${reply.code}`)

      if (port !== 465 && reply.lines.some((line) => /STARTTLS/i.test(line))) {
        send('STARTTLS')
        reply = await read()
        if (reply.code !== 220) throw new Error(`smtp starttls ${reply.code}`)
        socket = tls.connect({ socket, servername: settings.smtpHost })
        await new Promise((resolve, reject) => {
          socket.once('secureConnect', resolve)
          socket.once('error', reject)
        })
        read = smtpReader(socket)
        reply = await ehlo()
        if (reply.code !== 250) throw new Error(`smtp ehlo after starttls ${reply.code}`)
      }

      send('AUTH LOGIN')
      reply = await read()
      if (reply.code !== 334) throw new Error(`smtp auth ${reply.code}`)
      send(Buffer.from(settings.smtpUser, 'utf8').toString('base64'))
      reply = await read()
      if (reply.code !== 334) throw new Error(`smtp auth user ${reply.code}`)
      send(Buffer.from(settings.smtpPass, 'utf8').toString('base64'))
      reply = await read()
      if (reply.code !== 235) throw new Error(`smtp auth rejected ${reply.code}`)

      send(`MAIL FROM:<${from}>`)
      reply = await read()
      if (reply.code !== 250) throw new Error(`smtp mail from ${reply.code}`)
      send(`RCPT TO:<${settings.to}>`)
      reply = await read()
      if (reply.code !== 250 && reply.code !== 251) throw new Error(`smtp rcpt ${reply.code}`)
      send('DATA')
      reply = await read()
      if (reply.code !== 354) throw new Error(`smtp data ${reply.code}`)
      socket.write(`${mimeMessage(message, from, settings.to)}\r\n.\r\n`)
      reply = await read()
      if (reply.code !== 250) throw new Error(`smtp message rejected ${reply.code}`)
      send('QUIT')
      return { ok: true }
    } catch (error) {
      log.warn?.(`[remote-control] smtp send failed: ${error?.message || error}`)
      return { ok: false, error: error?.message || String(error) }
    } finally {
      try { socket?.end() } catch { /* ignore */ }
      try { socket?.destroy() } catch { /* ignore */ }
    }
  }

  async function publish(payload) {
    if (!enabled) return { ok: false, error: 'notifier-disabled' }
    if (settings.kind === 'mailgun') return sendMailgun(payload)
    if (settings.kind === 'smtp') return sendSmtp(payload)
    let body
    let endpoint = settings.url
    if (settings.kind === 'ntfy') {
      const target = ntfyTarget()
      endpoint = target.endpoint
      body = ntfyBody(payload)
      if (target.topic) body.topic = target.topic
    } else {
      body = webhookBody(payload)
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    timer.unref?.()
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(settings.token ? { authorization: `Bearer ${settings.token}` } : {}),
          ...settings.headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok) {
        log.warn?.(`[remote-control] notify failed with HTTP ${response.status}`)
        return { ok: false, error: `http-${response.status}` }
      }
      return { ok: true }
    } catch (error) {
      log.warn?.(`[remote-control] notify failed: ${error?.message || error}`)
      return { ok: false, error: error?.message || String(error) }
    } finally {
      clearTimeout(timer)
    }
  }

  /** One notification for a parked approval or question. */
  function notifyRequest(frame) {
    if (!enabled) return Promise.resolve({ ok: false, error: 'notifier-disabled' })
    const kind = frame?.kind === 'question' ? 'question' : 'approval'
    if (!wants(kind)) return Promise.resolve({ ok: false, error: 'event-disabled' })

    const tool = String(frame?.toolName || '')
    const links = linksFor(frame.requestId)

    if (kind === 'approval') {
      const reason = typeof frame?.reason === 'string' && frame.reason.trim()
        ? frame.reason.trim()
        : `Allow this operation${tool ? `: ${tool}` : ''}`
      return publish({
        kind: 'approval',
        title: 'Approval needed',
        message: reason,
        tags: ['warning'],
        requestId: frame.requestId,
        sessionId: frame.sessionId,
        toolName: tool,
        links,
      })
    }

    const first = Array.isArray(frame?.questions) ? frame.questions[0] : undefined
    const question = first?.question || first?.label || 'The agent needs an answer'
    // A question needs structured answers, which an approve/deny link cannot
    // express: `hitl.answer` only accepts a decision for approvals. Link to the
    // page instead so the recipient answers there.
    const openLink = settings.baseUrl
      ? [{ decision: 'open', label: 'Open the page', url: settings.baseUrl }]
      : undefined
    return publish({
      kind: 'question',
      title: 'Question from the agent',
      message: String(question).slice(0, 300),
      tags: ['question'],
      requestId: frame.requestId,
      sessionId: frame.sessionId,
      links: openLink,
    })
  }

  return {
    settings,
    enabled,
    wants,
    publish,
    notifyRequest,
    linksFor,
    stats: () => ({
      kind: settings.kind,
      enabled,
      events: [...events],
      hasActions: Boolean(settings.baseUrl),
      ...(settings.kind === 'mailgun' ? { to: settings.to, domain: settings.domain, hasKey: settings.apiKey !== '' } : {}),
      ...(settings.kind === 'smtp' ? { to: settings.to, host: settings.smtpHost, port: settings.smtpPort } : {}),
    }),
  }
}

import { createHmac, timingSafeEqual } from 'node:crypto'

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
  const kind = ['ntfy', 'webhook', 'mailgun'].includes(source.kind) ? source.kind : 'none'
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
  }
}

export function createNotifier({ config, secret, log = console } = {}) {
  const settings = normalizeNotify(config)
  const events = new Set(settings.events)

  const enabled = settings.kind === 'mailgun'
    ? Boolean(settings.to && settings.domain && settings.apiKey)
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

  async function publish(payload) {
    if (!enabled) return { ok: false, error: 'notifier-disabled' }
    if (settings.kind === 'mailgun') return sendMailgun(payload)
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
    }),
  }
}

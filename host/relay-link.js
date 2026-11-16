import { createHash } from 'node:crypto'
import http from 'node:http'

/**
 * Outbound link to the remote-control relay.
 *
 * The relay is a rendezvous point, not a trust anchor: this link tunnels the
 * same signed `/peer/*` HTTP calls the LAN transport uses, so the receiving
 * Host still verifies the per-peer HMAC end to end. A compromised relay can
 * drop or delay traffic, but cannot forge a control command.
 *
 * Messages:
 *   http / http-response        unary call and its reply
 *   stream-open / stream-status / stream-chunk / stream-end / stream-cancel
 *                               SSE transcript relayed frame by frame
 */
export function createRelayLink({ url, key, deviceId, deviceName, userId, localPort, log }) {
  const base = String(url).replace(/\/+$/, '')
  const groupId = createHash('sha256').update(String(key)).digest('hex')
  const peers = new Map()
  const pending = new Map()
  const streams = new Map()
  const locals = new Map()

  let token
  let stopped = false
  let heartbeatTimer
  let sequence = 0
  let security

  async function start() {
    await register()
    heartbeatTimer = setInterval(() => { heartbeat().catch(() => {}) }, 5000)
    heartbeatTimer.unref?.()
    inboxLoop().catch((error) => log.warn(`[remote-control] relay inbox stopped: ${error?.message || error}`))
  }

  function stop() {
    stopped = true
    clearInterval(heartbeatTimer)
    for (const entry of pending.values()) entry.resolve({ status: 503, body: '{"error":"relay-stopped"}' })
    pending.clear()
    for (const entry of streams.values()) entry.onEnd()
    streams.clear()
    for (const request of locals.values()) { try { request.destroy() } catch { /* ignore */ } }
    locals.clear()
  }

  async function register() {
    const response = await fetch(`${base}/v1/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groupId, deviceId, name: deviceName, userId }),
    })
    if (!response.ok) throw new Error(`relay register failed: ${response.status}`)
    const data = await response.json()
    token = data.token
    applyPeers(data.peers)
    log.info(`[remote-control] relay connected: ${base}`)
  }

  async function heartbeat() {
    if (!token || stopped) return
    try {
      const response = await fetch(`${base}/v1/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (response.status === 401) { token = undefined; return }
      if (!response.ok) return
      const data = await response.json()
      applyPeers(data.peers)
    } catch { /* relay unreachable; next tick retries */ }
  }

  function applyPeers(list) {
    if (!Array.isArray(list)) return
    const seen = new Set()
    for (const item of list) {
      if (!item || typeof item.deviceId !== 'string') continue
      seen.add(item.deviceId)
      peers.set(item.deviceId, {
        deviceId: item.deviceId,
        name: typeof item.name === 'string' ? item.name : 'DSH device',
        userId: typeof item.userId === 'string' ? item.userId : null,
        lastSeen: Number(item.lastSeen) || Date.now(),
      })
    }
    for (const deviceId of peers.keys()) if (!seen.has(deviceId)) peers.delete(deviceId)
  }

  async function inboxLoop() {
    while (!stopped) {
      if (!token) {
        await delay(1500)
        try { await register() } catch { /* retry */ }
        continue
      }
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 40000)
        const response = await fetch(`${base}/v1/inbox?token=${encodeURIComponent(token)}&wait=25`, { signal: controller.signal })
        clearTimeout(timer)
        if (response.status === 401) { token = undefined; continue }
        if (!response.ok) { await delay(1000); continue }
        const data = await response.json()
        if (data.peers) applyPeers(data.peers)
        for (const item of data.messages ?? []) {
          dispatch(item.from, item.message).catch((error) => {
            log.warn(`[remote-control] relay dispatch failed: ${error?.message || error}`)
          })
        }
      } catch {
        if (stopped) return
        await delay(1000)
      }
    }
  }

  async function dispatch(from, message) {
    const encryptedInbound = Boolean(message && typeof message === 'object' && typeof message.enc === 'string')
    if (encryptedInbound) {
      // Sealed envelope from a peer that has pinned our keys.
      const opened = security?.open?.(from, message.enc)
      if (typeof opened !== 'string') return
      try { message = JSON.parse(opened) } catch { return }
    }
    if (!message || typeof message !== 'object') return
    switch (message.kind) {
      case 'http': {
        const result = await localRequest(message.method, message.path, message.headers, message.body)
        await send(from, {
          kind: 'http-response',
          id: message.id,
          status: result.status,
          body: result.body,
          // Answer in kind: a plaintext request predates the peer knowing our
          // key (the approval response itself), so its reply must stay plain.
          plain: !encryptedInbound,
        })
        return
      }
      case 'http-response': {
        const entry = pending.get(message.id)
        if (!entry) return
        pending.delete(message.id)
        entry.resolve({ status: message.status, body: message.body })
        return
      }
      case 'stream-open':
        openLocalStream(from, message, encryptedInbound)
        return
      case 'stream-status': {
        const entry = streams.get(message.id)
        entry?.onStatus?.(message.status)
        return
      }
      case 'stream-chunk': {
        streams.get(message.id)?.onChunk(message.chunk)
        return
      }
      case 'stream-end': {
        const entry = streams.get(message.id)
        if (!entry) return
        streams.delete(message.id)
        entry.onEnd()
        return
      }
      case 'stream-cancel': {
        const request = locals.get(message.id)
        if (!request) return
        locals.delete(message.id)
        try { request.destroy() } catch { /* ignore */ }
        return
      }
      default:
        return
    }
  }

  function localRequest(method, pathname, headers, body) {
    return new Promise((resolve) => {
      const request = http.request({
        host: '127.0.0.1',
        port: localPort,
        path: pathname,
        method,
        headers: { ...headers, host: `127.0.0.1:${localPort}`, 'x-dsh-via': 'relay' },
      }, (response) => {
        let data = ''
        response.on('data', (chunk) => { data += chunk })
        response.on('end', () => resolve({ status: response.statusCode ?? 502, body: data }))
      })
      request.on('error', (error) => resolve({
        status: 502,
        body: JSON.stringify({ error: 'local-unreachable', message: error?.message || String(error) }),
      }))
      if (body !== undefined && body !== null) request.write(body)
      request.end()
    })
  }

  function openLocalStream(from, message, encryptedInbound) {
    const id = message.id
    const request = http.request({
      host: '127.0.0.1',
      port: localPort,
      path: message.path,
      method: 'GET',
      headers: { ...message.headers, host: `127.0.0.1:${localPort}` },
    }, (response) => {
      // Chunks must reach the peer in order: one POST per chunk has no ordering
      // guarantee, and a reordered SSE stream never forms a complete frame.
      let chain = Promise.resolve()
      const push = (message) => {
        chain = chain.then(() => send(from, message)).catch(() => {})
      }
      push({ kind: 'stream-status', id, status: response.statusCode ?? 502, plain: !encryptedInbound })
      if ((response.statusCode ?? 500) >= 400) {
        response.resume()
        locals.delete(id)
        push({ kind: 'stream-end', id, plain: !encryptedInbound })
        return
      }
      response.on('data', (chunk) => {
        push({ kind: 'stream-chunk', id, chunk: chunk.toString('utf8'), plain: !encryptedInbound })
      })
      response.on('end', () => {
        locals.delete(id)
        push({ kind: 'stream-end', id, plain: !encryptedInbound })
      })
      response.on('error', () => {
        locals.delete(id)
        push({ kind: 'stream-end', id, plain: !encryptedInbound })
      })
    })
    request.on('error', () => {
      locals.delete(id)
      send(from, { kind: 'stream-end', id }).catch(() => {})
    })
    locals.set(id, request)
    request.end()
  }

  async function send(to, message) {
    if (!token) throw new Error('relay not registered')
    const { plain, ...rest } = message ?? {}
    let payload = rest
    if (security && !plain) {
      const sealed = security.seal?.(to, JSON.stringify(rest))
      if (typeof sealed === 'string') payload = { enc: sealed }
    }
    const response = await fetch(`${base}/v1/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, to, message: payload }),
    })
    if (response.status === 401) { token = undefined; throw new Error('relay unauthorized') }
    if (!response.ok) throw new Error(`relay send failed: ${response.status}`)
  }

  async function request(target, options) {
    if (!token) return { status: 503, body: '{"error":"relay-offline"}' }
    const id = nextId()
    const reply = new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        resolve({ status: 504, body: '{"error":"relay-timeout"}' })
      }, 20000)
      timer.unref?.()
      pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value) } })
    })
    await send(target, {
      kind: 'http',
      id,
      method: options.method,
      path: options.path,
      headers: options.headers,
      body: options.body,
    })
    return reply
  }

  function stream(target, options, res) {
    const id = nextId()
    let opened = false
    const entry = {
      onStatus(status) {
        if (opened) return
        opened = true
        if (status >= 400) {
          streams.delete(id)
          try {
            res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end('{"error":"peer-refused"}')
          } catch { /* ignore */ }
          return
        }
        try {
          res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store, no-transform',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
          })
        } catch { /* ignore */ }
      },
      onChunk(chunk) { try { res.write(chunk) } catch { /* ignore */ } },
      onEnd() { try { res.end() } catch { /* ignore */ } },
    }
    streams.set(id, entry)
    const timeout = setTimeout(() => {
      if (opened) return
      opened = true
      streams.delete(id)
      try {
        res.writeHead(504, { 'content-type': 'application/json; charset=utf-8' })
        res.end('{"error":"relay-timeout"}')
      } catch { /* ignore */ }
    }, 15000)
    timeout.unref?.()

    res.on('close', () => {
      clearTimeout(timeout)
      if (!streams.has(id)) return
      streams.delete(id)
      send(target, { kind: 'stream-cancel', id }).catch(() => {})
    })

    send(target, {
      kind: 'stream-open',
      id,
      path: options.path,
      headers: options.headers,
    }).catch((error) => {
      clearTimeout(timeout)
      streams.delete(id)
      if (!res.writableEnded) {
        try { res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: error?.message || 'relay-send-failed' })) } catch { /* ignore */ }
      }
    })
  }

  function nextId() {
    sequence += 1
    return `${deviceId}-${Date.now().toString(36)}-${sequence}`
  }

  return {
    start,
    stop,
    request,
    stream,
    setSecurity(next) { security = next },
    peers: () => [...peers.values()],
    url: () => base,
    connected: () => Boolean(token),
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

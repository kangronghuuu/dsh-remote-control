import { randomBytes } from 'node:crypto'

/**
 * Rendezvous relay core.
 *
 * Mountable in two ways: standalone (`relay/server.js`) or inside a DSH Host
 * (the Devices panel's "Create relay"), which is why it exposes `handle`
 * instead of owning a socket. The protocol is plain HTTP long-poll so it works
 * through any proxy and needs no dependency.
 *
 * Groups are keyed by sha256(workspaceKey), computed by the client, so the
 * relay never sees the workspace key. Peer control stays end-to-end signed by
 * the devices themselves; this process only routes.
 */
export function createRelay({ log = console, onMessage } = {}) {
  const devices = new Map() // deviceId -> record
  const tokens = new Map() // token -> deviceId

  const DEVICE_TTL_MS = 60_000
  const MAX_QUEUE = 200
  const MAX_BODY_BYTES = 2 * 1024 * 1024
  const MAX_WAIT_SECONDS = 30

  const reaper = setInterval(() => {
    const now = Date.now()
    for (const [deviceId, record] of devices) {
      if (now - record.lastSeen <= DEVICE_TTL_MS) continue
      devices.delete(deviceId)
      tokens.delete(record.token)
    }
  }, 15_000)
  reaper.unref?.()

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://relay')
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, devices: devices.size })
    }
    if (req.method === 'POST' && url.pathname === '/v1/register') return register(req, res)
    if (req.method === 'POST' && url.pathname === '/v1/heartbeat') return heartbeat(req, res)
    if (req.method === 'POST' && url.pathname === '/v1/send') return forward(req, res)
    if (req.method === 'GET' && url.pathname === '/v1/inbox') return inbox(url, res)
    return send(res, 404, { error: 'not-found' })
  }

  async function register(req, res) {
    const body = await readJson(req)
    const groupId = typeof body?.groupId === 'string' ? body.groupId : ''
    const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : ''
    if (!/^[0-9a-f]{32,64}$/.test(groupId)) return send(res, 400, { error: 'bad-group' })
    if (!deviceId || deviceId.length > 128) return send(res, 400, { error: 'bad-device' })

    let record = devices.get(deviceId)
    if (record && record.groupId !== groupId) return send(res, 409, { error: 'device-in-use' })
    if (!record) {
      record = {
        deviceId,
        groupId,
        token: randomBytes(24).toString('hex'),
        name: typeof body?.name === 'string' ? body.name.slice(0, 80) : 'DSH device',
        userId: typeof body?.userId === 'string' ? body.userId : null,
        lastSeen: Date.now(),
        queue: [],
        waiters: new Set(),
      }
      devices.set(deviceId, record)
      tokens.set(record.token, deviceId)
    } else {
      record.lastSeen = Date.now()
      if (typeof body?.name === 'string') record.name = body.name.slice(0, 80)
      if (typeof body?.userId === 'string') record.userId = body.userId
    }
    log.info?.(`[relay] register ${record.name} (${deviceId.slice(0, 12)})`)
    return send(res, 200, { token: record.token, peers: peerList(record) })
  }

  async function heartbeat(req, res) {
    const body = await readJson(req)
    const record = authorize(body?.token)
    if (!record) return send(res, 401, { error: 'unauthorized' })
    record.lastSeen = Date.now()
    return send(res, 200, { ok: true, peers: peerList(record) })
  }

  async function forward(req, res) {
    const body = await readJson(req)
    const from = authorize(body?.token)
    if (!from) return send(res, 401, { error: 'unauthorized' })
    const to = devices.get(String(body?.to || ''))
    if (!to || to.groupId !== from.groupId) return send(res, 404, { error: 'unknown-peer' })
    const message = body?.message
    if (message === undefined || JSON.stringify(message).length > MAX_BODY_BYTES) {
      return send(res, 413, { error: 'too-large' })
    }
    if (to.queue.length >= MAX_QUEUE) to.queue.shift()
    onMessage?.({ from: from.deviceId, to: to.deviceId, message })
    to.queue.push({ from: from.deviceId, message, at: Date.now() })
    wake(to)
    return send(res, 200, { ok: true })
  }

  function inbox(url, res) {
    const record = authorize(url.searchParams.get('token'))
    if (!record) return send(res, 401, { error: 'unauthorized' })
    record.lastSeen = Date.now()
    if (record.queue.length > 0) return send(res, 200, { messages: drain(record), peers: peerList(record) })

    const waitSeconds = Math.min(Number(url.searchParams.get('wait') || 25) || 25, MAX_WAIT_SECONDS)
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      record.waiters.delete(finish)
      try { send(res, 200, { messages: drain(record), peers: peerList(record) }) } catch { /* client gone */ }
    }
    record.waiters.add(finish)
    const timer = setTimeout(finish, waitSeconds * 1000)
    res.on('close', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      record.waiters.delete(finish)
    })
  }

  function drain(record) {
    const messages = record.queue
    record.queue = []
    return messages
  }

  function wake(record) {
    for (const waiter of [...record.waiters]) waiter()
  }

  function authorize(token) {
    if (typeof token !== 'string' || !token) return undefined
    const deviceId = tokens.get(token)
    if (!deviceId) return undefined
    const record = devices.get(deviceId)
    if (!record) { tokens.delete(token); return undefined }
    return record
  }

  function peerList(self) {
    const now = Date.now()
    const items = []
    for (const record of devices.values()) {
      if (record.groupId !== self.groupId || record.deviceId === self.deviceId) continue
      if (now - record.lastSeen > DEVICE_TTL_MS) continue
      items.push({ deviceId: record.deviceId, name: record.name, userId: record.userId, lastSeen: record.lastSeen })
    }
    return items
  }

  return {
    handle,
    stats: () => ({ devices: devices.size }),
    close: () => clearInterval(reaper),
  }
}

function send(res, status, value) {
  if (res.writableEnded) return
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 2 * 1024 * 1024) { reject(new Error('too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) return resolve({})
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (error) { reject(error) }
    })
    req.on('error', reject)
  })
}

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import dgram from 'node:dgram'
import http from 'node:http'
import https from 'node:https'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { sasCode, signPayload, verifyPayload } from './identity.js'
import { createCipherPair, createBoxCipher, deriveEphemeralKey, deriveSessionKey, ephemeralPublicPem, generateEphemeralKeypair, preferredCipherName, supportedCiphers, WIRE_VERSION } from './crypto.js'
import { mintEphemeral, verifyEphemeral } from './handshake.js'
import { localCandidates } from './nat.js'
import { createPuncher } from './punch.js'
import { createP2pNode } from './p2p.js'
import { selectLane } from './lane.js'

const ANNOUNCE_KIND = 'dsh-remote/announce'
const ANNOUNCE_INTERVAL_MS = 4000
const PEER_TTL_MS = 15000
const REQUEST_TTL_MS = 10 * 60 * 1000
const CLOCK_SKEW_MS = 5 * 60 * 1000
/** Statuses that mean "the peer answered", as opposed to the relay failing. */
const PEER_LEVEL_STATUS = new Set([400, 401, 403, 409, 413, 422, 429])

// callDirect() is module-level, but the rehandshake routine lives inside
// createFabric(). The factory installs it here so a stale lane can be rotated
// from the shared transport code.
let rehandshakeHook = null
// Upload chunks carry up to 1 MiB of base64 (~1.4 MiB of JSON), above the
// default body cap; the relay's own per-message cap stays at 2 MiB.
const UPLOAD_BODY_BYTES = 4 * 1024 * 1024

/** Capability scopes; an approval without an explicit list keeps all of them. */
export const DEFAULT_SCOPES = [
  'sessions:list',
  'transcript:read',
  'prompt:send',
  'stop',
  'config:read',
  'config:write',
  'files:write',
]

const SCOPE_BY_PATH = [
  [/^\/peer\/sessions$/, () => 'sessions:list'],
  [/^\/peer\/stream$/, () => 'transcript:read'],
  [/^\/peer\/prompt$/, () => 'prompt:send'],
  [/^\/peer\/cancel$/, () => 'stop'],
  [/^\/peer\/session\/config$/, (method) => (method === 'GET' ? 'config:read' : 'config:write')],
  [/^\/peer\/hitl$/, () => 'transcript:read'],
  [/^\/peer\/hitl\/answer$/, () => 'prompt:send'],
  [/^\/peer\/attachment$/, () => 'transcript:read'],
  [/^\/peer\/state$/, () => 'transcript:read'],
  [/^\/peer\/queue$/, () => 'prompt:send'],
  [/^\/peer\/history$/, () => 'transcript:read'],
  [/^\/peer\/new-session$/, () => 'prompt:send'],
  [/^\/peer\/upload\//, () => 'files:write'],
]

function scopeFor(method, pathname) {
  for (const [pattern, pick] of SCOPE_BY_PATH) {
    if (pattern.test(pathname)) return pick(method)
  }
  return undefined
}

/**
 * Peer fabric: LAN discovery, one-time approval, and the authenticated
 * peer-to-peer control calls used by the Devices panel.
 *
 * Everything here is plain Node so it can be exercised without Cordis:
 * `sessions` is a small facade over the Host's session controller.
 */
export function createFabric({ log, config, self, sessions, stateFile, store, uploads, identity, hitl, readAttachment, limits = {} }) {
  const approvalStore = store ?? createFileStore(stateFile, log)
  const rate = new Map() // deviceId -> { count, resetAt }
  const rateLimit = {
    windowMs: limits.rateWindowMs ?? 10_000,
    max: limits.rateMax ?? 120,
  }
  function allowCall(deviceId) {
    const now = Date.now()
    const entry = rate.get(deviceId)
    if (!entry || entry.resetAt <= now) {
      rate.set(deviceId, { count: 1, resetAt: now + rateLimit.windowMs })
      return true
    }
    entry.count += 1
    return entry.count <= rateLimit.max
  }
  const peers = new Map() // deviceId -> peer record
  const requests = new Map() // requestId -> inbound approval request
  const outgoing = new Map() // deviceId -> { requestId, at }
  const approvals = new Map() // deviceId -> { deviceName, secret, approvedAt }
  const sockets = []
  let announceTimer
  let reaper
  let loaded = false
  let relay
  const ciphers = new Map()
  const seenNonces = new Map()

  /** Reject a nonce already spent by this peer inside the clock window. */
  function acceptNonce(deviceId, nonce) {
    const now = Date.now()
    let bucket = seenNonces.get(deviceId)
    if (!bucket) { bucket = new Map(); seenNonces.set(deviceId, bucket) }
    for (const [key, expiry] of bucket) if (expiry <= now) bucket.delete(key)
    if (bucket.has(nonce)) return false
    bucket.set(nonce, now + CLOCK_SKEW_MS)
    return true
  }

  /**
   * Per-call authentication: the device's Ed25519 key when the peer's key is
   * pinned, otherwise the legacy shared-secret HMAC so 0.3.x peers keep working.
   */
  function authHeaders(peerDeviceId, method, pathname) {
    const approval = approvals.get(peerDeviceId)
    const me = currentIdentity()
    const timestamp = String(Date.now())
    if (approval?.publicKey && me?.ed25519?.privateKey) {
      const nonce = randomBytes(12).toString('hex')
      const payload = `${self().deviceId}\n${method}\n${pathname}\n${timestamp}\n${nonce}`
      return {
        'x-dsh-peer-id': self().deviceId,
        'x-dsh-peer-ts': timestamp,
        'x-dsh-peer-nonce': nonce,
        'x-dsh-peer-alg': 'ed25519',
        'x-dsh-peer-sig': signPayload(me.ed25519.privateKey, payload),
      }
    }
    if (approval?.secret) {
      return {
        'x-dsh-peer-id': self().deviceId,
        'x-dsh-peer-ts': timestamp,
        'x-dsh-peer-sig': sign(approval.secret, self().deviceId, method, pathname, timestamp, ''),
      }
    }
    return undefined
  }

  const currentIdentity = () => (typeof identity === 'function' ? identity() : identity)

  const ephemerals = new Map() // peerDeviceId -> local X25519 private key
  const rotating = new Set()

  /** Mint this side's ephemeral message for one pairing attempt. */
  function mintFor(peerDeviceId, pairCode) {
    const me = currentIdentity()
    if (!me?.ed25519?.privateKey) return undefined
    const keypair = generateEphemeralKeypair()
    ephemerals.set(peerDeviceId, keypair.privateKey)
    const message = mintEphemeral(me, self().deviceId, pairCode, keypair)
    return message
  }

  /** Session key: ephemeral+static when both sides agreed, else static-static. */
  function sessionKeyFor(peerDeviceId, label) {
    const me = currentIdentity()
    const approval = approvals.get(peerDeviceId)
    if (!me?.x25519?.privateKey || !approval?.agreementKey) return undefined
    const ephemeralPrivate = ephemerals.get(peerDeviceId)
    if (ephemeralPrivate && approval.peerEphemeral) {
      try {
        const key = deriveEphemeralKey({
          ephemeralPrivate,
          peerEphemeralPublicPem: approval.peerEphemeral,
          staticPrivate: me.x25519.privateKey,
          peerStaticPublicPem: approval.agreementKey,
          myFingerprint: me.fingerprint,
          peerFingerprint: approval.fingerprint,
          label,
        })
        return key
      } catch { /* fall back to static-static */ }
    }
    const fallback = deriveSessionKey({
      privateKey: me.x25519.privateKey,
      peerPublicKeyPem: approval.agreementKey,
      myFingerprint: me.fingerprint,
      peerFingerprint: approval.fingerprint,
      label,
    })
    return fallback
  }

  function cipherFor(peerDeviceId) {
    const me = currentIdentity()
    if (!me?.x25519?.privateKey) return undefined
    const approval = approvals.get(peerDeviceId)
    if (!approval?.agreementKey || !approval?.fingerprint) return undefined
    const cached = ciphers.get(peerDeviceId)
    if (cached) return cached
    try {
      const key = sessionKeyFor(peerDeviceId, 'channel')
      if (!key) return undefined
      const side = String(self().deviceId) < String(peerDeviceId) ? 'a' : 'b'
      const pair = createCipherPair(key, side)
      ciphers.set(peerDeviceId, pair)
      return pair
    } catch (error) {
      log.warn(`[remote-control] channel setup failed for ${peerDeviceId}: ${error?.message || error}`)
      return undefined
    }
  }

  const lanCiphers = new Map()
  const p2pBoxes = new Map()
  let p2pNode
  let publicEndpoint

  /** True when this device and the peer share at least one envelope cipher. */
  function cipherCompatible(approval) {
    const mine = supportedCiphers()
    const theirs = Array.isArray(approval?.ciphers) && approval.ciphers.length > 0 ? approval.ciphers : null
    // A peer that does not advertise ciphers is a legacy build that hardcodes
    // ChaCha: only compatible if this runtime can actually do ChaCha.
    if (!theirs) return preferredCipherName() === 'chacha20-poly1305'
    return theirs.some((name) => mine.includes(name))
  }
  const staticLanes = new Map()

  /** Static-static pair for one lane: the fallback during/after a restart. */
  function staticLaneCipher(peerDeviceId, label = 'lan') {
    const me = currentIdentity()
    if (!me?.x25519?.privateKey) return undefined
    const approval = approvals.get(peerDeviceId)
    if (!approval?.agreementKey || !approval?.fingerprint) return undefined
    const cacheKey = `${label}:${peerDeviceId}`
    const cached = staticLanes.get(cacheKey)
    if (cached) return cached
    try {
      const key = deriveSessionKey({
        privateKey: me.x25519.privateKey,
        peerPublicKeyPem: approval.agreementKey,
        myFingerprint: me.fingerprint,
        peerFingerprint: approval.fingerprint,
        label,
      })
      const side = String(self().deviceId) < String(peerDeviceId) ? 'a' : 'b'
      const pair = createCipherPair(key, side)
      staticLanes.set(cacheKey, pair)
      return pair
    } catch {
      return undefined
    }
  }
  /** Drop every cached channel for one peer: stale pairs caused 504s after re-pair. */
  function invalidatePeerChannels(deviceId) {
    ciphers.delete(deviceId)
    for (const key of [...lanCiphers.keys()]) {
      if (key.endsWith(':' + deviceId)) lanCiphers.delete(key)
    }
    for (const key of [...staticLanes.keys()]) {
      if (key.endsWith(':' + deviceId)) staticLanes.delete(key)
    }
    p2pBoxes.delete(deviceId)
  }

  /** Open a sealed lane body, falling back to static-static after a restart. */
  function openLaneBody(peerDeviceId, packet, primary, label = 'lan') {
    if (primary) {
      try {
        return { body: JSON.parse(primary.open(packet).toString('utf8')), pair: primary }
      } catch { /* try the static fallback */ }
    }
    const fallback = staticLaneCipher(peerDeviceId, label)
    if (fallback && fallback !== primary) {
      return { body: JSON.parse(fallback.open(packet).toString('utf8')), pair: fallback }
    }
    throw new Error('lane open failed')
  }

  /** Sealed box for the p2p datagram lane, keyed per peer. */
  function p2pBoxFor(deviceId) {
    const key = sessionKeyFor(deviceId, 'p2p')
    if (!key) return undefined
    let box = p2pBoxes.get(deviceId)
    if (!box) {
      box = createBoxCipher(key)
      p2pBoxes.set(deviceId, box)
    }
    return box
  }

  /** Per-peer AEAD pair for one direct transport lane (separate nonce space). */
  function lanCipherFor(peerDeviceId, label = 'lan') {
    const me = currentIdentity()
    if (!me?.x25519?.privateKey) return undefined
    const approval = approvals.get(peerDeviceId)
    if (!approval?.agreementKey || !approval?.fingerprint) return undefined
    const cacheKey = `${label}:${peerDeviceId}`
    const cached = lanCiphers.get(cacheKey)
    if (cached) return cached
    try {
      const key = sessionKeyFor(peerDeviceId, label)
      if (!key) return undefined
      const side = String(self().deviceId) < String(peerDeviceId) ? 'a' : 'b'
      const pair = createCipherPair(key, side)
      lanCiphers.set(cacheKey, pair)
      return pair
    } catch {
      return undefined
    }
  }

  /** Mint an ephemeral message without installing it as the live key yet. */
  function mintDetached(pairCode) {
    const me = currentIdentity()
    if (!me?.ed25519?.privateKey) return undefined
    const keypair = generateEphemeralKeypair()
    return { privateKey: keypair.privateKey, message: mintEphemeral(me, self().deviceId, pairCode, keypair) }
  }

  /** Try to open a direct UDP path to one peer (both sides must call this). */
  async function punchPeer(peerDeviceId) {
    const approval = approvals.get(peerDeviceId)
    if (!approval) return { ok: false, error: 'unknown-peer' }
    const candidates = approval.candidates ?? []
    const punchPort = approval.punchPort ?? 0
    if (candidates.length === 0 || !punchPort) return { ok: false, error: 'no-candidates' }
    if (!p2pNode) return { ok: false, error: 'p2p-unavailable' }
    // The public mapping (STUN) is the only endpoint a NATed peer can answer on;
    // LAN candidates are tried with the local punch port as a same-network path.
    const targets = []
    if (approval.publicEndpoint?.address) {
      targets.push({ address: approval.publicEndpoint.address, port: approval.publicEndpoint.port })
    }
    for (const address of candidates) targets.push({ address, port: punchPort })
    for (const target of targets) {
      const result = await p2pNode.punch(target, peerDeviceId)
      if (!result.ok) continue
      approvals.set(peerDeviceId, { ...approval, punch: target })
      await saveApprovals()
      return { ok: true, address: target.address, port: target.port }
    }
    return { ok: false, error: 'no-pong' }
  }

  /** Rotate the ephemeral channel with one approved peer. */
  async function rehandshakePeer(peerDeviceId) {

    const peer = peers.get(peerDeviceId)
    if (!peer) return { ok: false, error: 'unknown-peer' }
    // Two simultaneous initiators would each install a different ephemeral and
    // desynchronize the channel, so only one rotation may be in flight.
    if (rotating.has(peerDeviceId)) return { ok: false, error: 'in-progress' }
    rotating.add(peerDeviceId)
    try {
      const pairCode = self().pairCode ?? ''
      const minted = mintDetached(pairCode)
      if (!minted) return { ok: false, error: 'no-identity' }
      // The request still travels over the current channel; the new key is
      // installed only once the peer's signed reply verifies.
      // Deliberately unsealed. When one side restarted, the lane key is stale
      // and sealing the handshake with it fails with bad-envelope, which used
      // to force a full re-pair. Signature auth is enough to bootstrap a fresh
      // lane; the new key is installed only after the signed reply verifies.
      const headers = authHeaders(peer.deviceId, 'POST', '/peer/rehandshake')
      const result = await callDirect(
        peer, 'POST', '/peer/rehandshake', { ephemeral: minted.message },
        approvals.get(peerDeviceId)?.secret ?? '', self().deviceId, headers, undefined,
        config.directTimeoutMs ?? 3000, false,
      )
      if (!result.ok) return { ok: false, error: result.json?.error || result.error || 'rehandshake-failed' }
      const theirs = result.json?.ephemeral
      const approval = approvals.get(peerDeviceId)
      if (!verifyEphemeral(approval?.publicKey ?? '', peerDeviceId, pairCode, theirs)) {
        return { ok: false, error: 'bad-handshake' }
      }
      ephemerals.set(peerDeviceId, minted.privateKey)
      approvals.set(peerDeviceId, { ...approval, peerEphemeral: theirs.publicPem, rotatedAt: Date.now() })
      invalidatePeerChannels(peerDeviceId)
      await saveApprovals()
      return { ok: true }
    } finally {
      rotating.delete(peerDeviceId)
    }
  }

  const security = {
    seal(to, text) {
      const pair = cipherFor(to)
      if (!pair) return undefined
      return pair.seal(text) // a cipher failure must surface, never silently downgrade
    },
    open(from, packet) {
      const pair = cipherFor(from)
      if (pair) {
        try { return pair.open(packet).toString('utf8') } catch { /* try the static fallback */ }
      }
      const fallback = staticLaneCipher(from, 'channel')
      if (fallback && fallback !== pair) {
        try { return fallback.open(packet).toString('utf8') } catch { /* below */ }
      }
      log.warn(`[remote-control] dropped an unauthenticated relay message from ${from}`)
      return undefined
    },
  }

  const discoveryPort = config.discoveryPort
  const enabled = config.discovery !== false

  async function start() {
    await loadApprovals()

    // The p2p lane must exist even when LAN discovery is disabled.
    if (config.punchPort) {
      try {
        p2pNode = await createP2pNode({
          localPort: config.port,
          bindPort: config.punchPort,
          selfDeviceId: self().deviceId,
          log,
          keyFor: (deviceId) => p2pBoxFor(deviceId),
        })
      } catch (error) {
        log.warn(`[remote-control] could not open the p2p lane on ${config.punchPort}: ${error?.message || error}`)
      }
      // Learn this socket's public mapping so a NATed peer advertises something
      // reachable. Without this only LAN addresses would be offered.
      if (p2pNode && config.stunHost !== false) {
        try {
          const mapped = await p2pNode.mapped({
            host: config.stunHost || 'stun.l.google.com',
            port: config.stunPort ?? 19302,
            timeoutMs: config.stunTimeoutMs ?? 1500,
          })
          if (mapped?.address) publicEndpoint = { address: mapped.address, port: mapped.port }
        } catch { /* no STUN reachable; LAN candidates still work */ }
      }
    }
    if (!enabled) return

    // Ephemeral keys live only in memory, so after a restart each approved peer
    // is re-handshaked once reachable; until then the channel uses static-static.
    // Restart recovery: ephemeral keys are in-memory only, so every peer this
    // process knew before the restart needs a fresh handshake. The lower device
    // id initiates first; the higher one only steps in if that did not land, so
    // two simultaneous restarts do not rotate over each other.
    // Two one-shot attempts are not enough: a peer that was still restarting at
    // that moment stayed on a stale key and every later call failed with
    // bad-envelope until the Host itself restarted. Keep retrying on a slow tick
    // while any approved peer still lacks an ephemeral.
    const refreshMs = Number.isInteger(config.channelRefreshMs) ? config.channelRefreshMs : 2500
    // Retry every 10s while a peer still lacks an ephemeral, so a one-side
    // restart heals within seconds instead of half a minute.
    const refreshRetryMs = Math.min(Math.max(refreshMs * 4, 10_000), 30_000)
    const refreshOne = () => {
      let missing = 0
      for (const deviceId of approvals.keys()) {
        if (ephemerals.has(deviceId)) continue
        const rotatedAt = approvals.get(deviceId)?.rotatedAt
        if (rotatedAt && Date.now() - rotatedAt < 60_000) continue
        missing += 1
        rehandshakePeer(deviceId).catch(() => { /* peer offline */ })
      }
      return missing
    }
    let refreshTimer
    const scheduleRefresh = (delayMs) => {
      const timer = setTimeout(() => {
        const missing = refreshOne()
        if (missing > 0) scheduleRefresh(refreshRetryMs)
      }, delayMs)
      timer.unref?.()
      return timer
    }
    const firstRefresh = refreshMs > 0 ? scheduleRefresh(refreshMs) : undefined

    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    sockets.push(socket)
    socket.on('error', (error) => log.warn(`[remote-control] discovery socket: ${error?.message || error}`))
    socket.on('message', (buffer, rinfo) => {
      try {
        onAnnounce(JSON.parse(buffer.toString('utf8')), rinfo)
      } catch { /* ignore malformed datagrams */ }
    })
    await new Promise((resolve) => {
      socket.bind(discoveryPort, () => {
        try { socket.setBroadcast(true) } catch { /* ignore */ }
        resolve()
      })
    })

    announceTimer = setInterval(announce, ANNOUNCE_INTERVAL_MS)
    announceTimer.unref?.()
    announce()
    reaper = setInterval(reap, 5000)
    reaper.unref?.()
  }

  function stop() {
    clearInterval(announceTimer)
    clearInterval(reaper)
    try { p2pNode?.close() } catch { /* already closed */ }
    p2pNode = undefined
    p2pBoxes.clear()
    for (const socket of sockets) {
      try { socket.close() } catch { /* ignore */ }
    }
    sockets.length = 0
  }

  function announce() {
    const who = self()
    if (!who.deviceId) return
    const payload = Buffer.from(JSON.stringify({
      v: 1,
      kind: ANNOUNCE_KIND,
      deviceId: who.deviceId,
      deviceName: who.deviceName,
      userId: who.userId,
      port: who.port,
      proto: who.proto,
      ts: Date.now(),
    }))
    for (const socket of sockets) {
      try { socket.send(payload, 0, payload.length, discoveryPort, '255.255.255.255') } catch { /* ignore */ }
      try { socket.send(payload, 0, payload.length, discoveryPort, '127.0.0.1') } catch { /* ignore */ }
    }
  }

  function onAnnounce(message, rinfo) {
    if (!message || message.kind !== ANNOUNCE_KIND) return
    if (typeof message.deviceId !== 'string' || !message.deviceId) return
    const who = self()
    if (message.deviceId === who.deviceId) return

    const existing = peers.get(message.deviceId)
    const incoming = {
      address: rinfo.address,
      port: Number(message.port) || 57330,
      proto: message.proto === 'https' ? 'https' : 'http',
      origin: message.origin === 'tailnet' ? 'tailnet' : 'lan',
    }
    // Keep every address seen for this peer. A LAN address is only reachable on
    // that subnet, so a broadcast announce must never displace a working tailnet
    // candidate: doing that made calls flap between 200 and a 2s 502 timeout.
    const previousCandidates = Array.isArray(existing?.candidates) ? existing.candidates : []
    const candidates = previousCandidates
      .filter((entry) => entry && typeof entry.address === 'string' && !(entry.address === incoming.address && entry.port === incoming.port))
      .slice(0, 3)
    candidates.push({ ...incoming, seenAt: Date.now() })
    const keepActive = incoming.origin !== 'tailnet' && existing?.origin === 'tailnet'
    peers.set(message.deviceId, {
      ...(existing ?? {}),
      deviceId: message.deviceId,
      deviceName: typeof message.deviceName === 'string' ? message.deviceName : (existing?.deviceName ?? 'DSH device'),
      userId: typeof message.userId === 'string' ? message.userId : (existing?.userId ?? null),
      ...(keepActive ? {} : incoming),
      candidates,
      lastSeen: Date.now(),
      approved: approvals.has(message.deviceId) || Boolean(existing?.approved),
      secret: approvals.get(message.deviceId)?.secret ?? existing?.secret,
    })
    // Fresh discovery evidence: retry the direct lane on the next call.
    routeBlocks.delete(message.deviceId)
  }

  function reap() {
    const now = Date.now()
    for (const [deviceId, peer] of peers) {
      if (peer.proto === 'relay') continue
      if (now - peer.lastSeen > PEER_TTL_MS) peers.delete(deviceId)
    }
    for (const [requestId, request] of requests) {
      if (now - request.at > REQUEST_TTL_MS) requests.delete(requestId)
    }
  }

  /**
   * Merge relay presence into the peer table. A directly discovered LAN peer
   * keeps its direct route; relay presence covers devices behind NAT.
   */
  function syncRelayPeers() {
    if (!relay) return
    const present = new Set()
    for (const item of relay.peers()) {
      present.add(item.deviceId)
      const existing = peers.get(item.deviceId)
      if (existing && existing.proto !== 'relay') continue
      peers.set(item.deviceId, {
        deviceId: item.deviceId,
        deviceName: item.name,
        userId: item.userId,
        address: 'relay',
        port: 0,
        proto: 'relay',
        lastSeen: item.lastSeen,
        approved: approvals.has(item.deviceId) || Boolean(existing?.approved),
        secret: approvals.get(item.deviceId)?.secret ?? existing?.secret,
      })
    }
    // Drop relay peers the relay no longer lists, so a device that leaves or a
    // relay that goes away cannot leave a peer that always answers 503.
    for (const [deviceId, peer] of peers) {
      if (peer.proto === 'relay' && !present.has(deviceId)) peers.delete(deviceId)
    }
  }

  async function loadApprovals() {
    if (loaded) return
    loaded = true
    try {
      const raw = await approvalStore.load()
      for (const [deviceId, entry] of Object.entries(raw?.peers ?? {})) {
        if (entry && typeof entry.secret === 'string') {
          approvals.set(deviceId, {
            deviceName: entry.deviceName ?? 'DSH device',
            secret: entry.secret,
            approvedAt: entry.approvedAt ?? Date.now(),
            relay: entry.relay ?? '',
            publicKey: entry.publicKey ?? '',
            fingerprint: entry.fingerprint ?? '',
            agreementKey: entry.agreementKey ?? '',
            peerEphemeral: entry.peerEphemeral ?? '',
            sas: entry.sas ?? '',
            ciphers: Array.isArray(entry.ciphers) ? entry.ciphers : [],
            scopes: Array.isArray(entry.scopes) ? entry.scopes : [...DEFAULT_SCOPES],
          })
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') log.warn(`[remote-control] could not read ${stateFile}: ${error?.message || error}`)
    }
  }

  async function saveApprovals() {
    const peersObject = {}
    for (const [deviceId, entry] of approvals) peersObject[deviceId] = entry
    try {
      await approvalStore.save({ version: 1, peers: peersObject })
    } catch (error) {
      log.warn(`[remote-control] could not persist approvals: ${error?.message || error}`)
    }
    // Mirror the same records into the flat file. The credential store is the
    // primary source, but when it is not ready early in start-up the loader
    // falls back to this file; leaving an old key-less copy there made every
    // signed call fail with "unapproved-device" after a restart.
    try {
      await writeFile(stateFile, JSON.stringify({ version: 1, peers: peersObject }, null, 2), { mode: 0o600 })
    } catch (error) {
      log.warn(`[remote-control] could not mirror approvals to ${stateFile}: ${error?.message || error}`)
    }
  }

  /* ---------------- inbound: hello + approval ---------------- */

  function createHello(req, res) {
    readJson(req).then(async (body) => {
      const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : ''
      if (!deviceId) return json(res, 400, { error: 'missing-device' })
      if (requests.size >= 20) return json(res, 429, { error: 'too-many-requests' })
      // A peer built against another wire version cannot open our envelopes.
      // Say so here, while it is still a clear error, instead of letting every
      // later call fail as an undecryptable body.
      const claimedWire = Number.isInteger(body?.wire) ? body.wire : 0
      if (claimedWire !== 0 && claimedWire !== WIRE_VERSION) {
        log.warn(`[remote-control] refusing peer ${deviceId}: wire ${claimedWire}, this Host speaks ${WIRE_VERSION}`)
        return json(res, 409, { error: 'version-mismatch', theirs: claimedWire, mine: WIRE_VERSION })
      }
      const requestId = randomBytes(16).toString('hex')
      const claimedRelay = typeof body?.relay === 'string' ? body.relay : ''
      const claimedPairCode = typeof body?.pairCode === 'string' ? body.pairCode : ''
      const claimedFingerprint = typeof body?.fingerprint === 'string' ? body.fingerprint : ''
      const claimedKey = typeof body?.publicKey === 'string' ? body.publicKey : ''
      const known = approvals.get(deviceId)
      const who = self()
      const claimedEphemeral = body?.ephemeral
      const ephemeralOk = verifyEphemeral(claimedKey, deviceId, claimedPairCode, claimedEphemeral)
      const replyEphemeral = mintFor(deviceId, claimedPairCode)
      requests.set(requestId, {
        requestId,
        deviceId,
        deviceName: typeof body.deviceName === 'string' ? body.deviceName : 'DSH device',
        userId: typeof body.userId === 'string' ? body.userId : null,
        relay: claimedRelay,
        pairCode: claimedPairCode,
        publicKey: claimedKey,
        fingerprint: claimedFingerprint,
        ciphers: Array.isArray(body?.ciphers) ? body.ciphers.filter((entry) => typeof entry === 'string').slice(0, 8) : [],
        peerEphemeral: ephemeralOk ? claimedEphemeral.publicPem : '',
        candidates: Array.isArray(body?.candidates) ? body.candidates.filter((entry) => typeof entry === 'string').slice(0, 16) : [],
        punchPort: Number.isInteger(body?.punchPort) ? body.punchPort : 0,
        publicEndpoint: body?.publicEndpoint && typeof body.publicEndpoint.address === 'string' && Number.isInteger(body.publicEndpoint.port)
          ? { address: body.publicEndpoint.address, port: body.publicEndpoint.port }
          : null,
        replyEphemeral,
        agreementKey: typeof body?.agreementKey === 'string' ? body.agreementKey : '',
        // Both screens show these digits only when both keys and the invite
        // nonce agree; a mismatch is a hard stop, not a warning.
        sas: claimedFingerprint && who.fingerprint
          ? sasCode(who.fingerprint, claimedFingerprint, claimedPairCode)
          : '',
        relayChanged: Boolean(known?.relay && claimedRelay && known.relay !== claimedRelay),
        wire: claimedWire || WIRE_VERSION,
        address: req.socket?.remoteAddress ?? '',
        at: Date.now(),
        status: 'pending',
      })
      log.info(`[remote-control] approval requested by ${deviceId}`)
      return json(res, 200, { requestId, status: 'pending', wire: WIRE_VERSION })
    }).catch((error) => json(res, 400, { error: 'bad-request', message: String(error?.message || error) }))
  }

  function helloStatus(res, requestId) {
    const request = requests.get(requestId)
    if (!request) return json(res, 404, { error: 'unknown-request' })
    const who = self()
    if (request.status === 'approved') {
      return json(res, 200, {
        status: 'approved',
        // A peer that pinned a device key never needs the shared secret, and
        // the relay would see this response in plaintext. Only legacy peers
        // (no claimed public key) still receive one.
        ...(request.publicKey ? {} : { secret: request.secret }),
        deviceName: who.deviceName,
        publicKey: who.publicKey ?? '',
        fingerprint: who.fingerprint ?? '',
        agreementKey: who.agreementKey ?? '',
        ciphers: supportedCiphers(),
        wire: WIRE_VERSION,
        ephemeral: request.replyEphemeral,
        candidates: localCandidates().map((entry) => entry.address),
        punchPort: config.punchPort ?? 0,
        publicEndpoint: publicEndpoint ?? null,
        sas: request.sas ?? '',
      })
    }
    return json(res, 200, { status: request.status, sas: request.sas ?? '' })
  }

  async function approveRequest(requestId) {
    const request = requests.get(requestId)
    if (!request) return { ok: false, error: 'unknown-request' }
    const secret = randomBytes(32).toString('hex')
    request.status = 'approved'
    request.secret = secret
    approvals.set(request.deviceId, {
      deviceName: request.deviceName,
      secret,
      approvedAt: Date.now(),
      relay: request.relay ?? '',
      publicKey: request.publicKey ?? '',
      fingerprint: request.fingerprint ?? '',
      agreementKey: request.agreementKey ?? '',
      ciphers: Array.isArray(request.ciphers) ? request.ciphers : [],
      peerEphemeral: request.peerEphemeral ?? '',
      candidates: Array.isArray(request.candidates) ? request.candidates : [],
      punchPort: Number.isInteger(request.punchPort) ? request.punchPort : 0,
      publicEndpoint: request.publicEndpoint ?? null,
      secret: request.publicKey ? '' : request.secret,
      sas: request.sas ?? '',
      scopes: [...DEFAULT_SCOPES],
    })
    invalidatePeerChannels(request.deviceId)
    await saveApprovals()
    const peer = peers.get(request.deviceId)
    if (peer) { peer.approved = true; peer.secret = secret }
    log.info(`[remote-control] approved ${request.deviceName} (${request.deviceId})`)
    return { ok: true }
  }

  function denyRequest(requestId) {
    const request = requests.get(requestId)
    if (!request) return { ok: false, error: 'unknown-request' }
    request.status = 'denied'
    return { ok: true }
  }

  /* ---------------- outbound: connect to a peer ---------------- */

  async function connect(deviceId) {
    syncRelayPeers()
    const peer = peers.get(deviceId)
    if (!peer) return { ok: false, error: 'unknown-peer' }
    if (approvals.has(deviceId)) return { ok: true, approved: true }

    const who = self()
    const reply = await peerCall(peer, 'POST', '/peer/hello', {
      deviceId: who.deviceId,
      deviceName: who.deviceName,
      userId: who.userId,
      relay: who.relayUrl ?? '',
      pairCode: who.pairCode ?? '',
      publicKey: who.publicKey ?? '',
      fingerprint: who.fingerprint ?? '',
      agreementKey: who.agreementKey ?? '',
      ciphers: supportedCiphers(),
      wire: WIRE_VERSION,
      ephemeral: mintFor(peer.deviceId, who.pairCode ?? ''),
      candidates: localCandidates().map((entry) => entry.address),
      punchPort: config.punchPort ?? 0,
      publicEndpoint: publicEndpoint ?? null,
    })
    if (!reply.ok || typeof reply.json?.requestId !== 'string') {
      return { ok: false, error: reply.json?.error || reply.error || 'hello-failed' }
    }
    if (Number.isInteger(reply.json?.wire) && reply.json.wire !== WIRE_VERSION) {
      return { ok: false, error: 'version-mismatch', theirs: reply.json.wire, mine: WIRE_VERSION }
    }
    outgoing.set(deviceId, { requestId: reply.json.requestId, at: Date.now() })

    // Poll in the background; the target approves in its own Devices panel.
    pollApproval(peer, reply.json.requestId).catch(() => {})
    return { ok: true, approved: false, requestId: reply.json.requestId }
  }

  async function pollApproval(peer, requestId) {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      await delay(1000)
      if (!outgoing.has(peer.deviceId)) return
      const reply = await peerCall(peer, 'GET', `/peer/hello/${requestId}`)
      const status = reply.json?.status
      if (Number.isInteger(reply.json?.wire) && reply.json.wire !== WIRE_VERSION) {
        log.warn(`[remote-control] ${peer.deviceName} speaks wire ${reply.json.wire}, this Host speaks ${WIRE_VERSION}; not installing the approval`)
        outgoing.delete(peer.deviceId)
        return
      }
      if (status === 'approved') {
        const replyEphemeral = reply.json.ephemeral
        const ephemeralOk = verifyEphemeral(reply.json.publicKey ?? '', peer.deviceId, self().pairCode ?? '', replyEphemeral)
        approvals.set(peer.deviceId, {
          deviceName: peer.deviceName,
          secret: reply.json.secret ?? '',
          approvedAt: Date.now(),
          relay: relay?.url() ?? '',
          publicKey: reply.json.publicKey ?? '',
          fingerprint: reply.json.fingerprint ?? '',
          agreementKey: reply.json.agreementKey ?? '',
          ciphers: Array.isArray(reply.json.ciphers) ? reply.json.ciphers : [],
          peerEphemeral: ephemeralOk ? replyEphemeral.publicPem : '',
          candidates: Array.isArray(reply.json.candidates) ? reply.json.candidates : [],
          punchPort: Number.isInteger(reply.json.punchPort) ? reply.json.punchPort : 0,
          publicEndpoint: reply.json.publicEndpoint ?? null,
          sas: reply.json.sas ?? '',
          scopes: [...DEFAULT_SCOPES],
        })
        invalidatePeerChannels(peer.deviceId)
        peer.publicKey = reply.json.publicKey ?? ''
        peer.sas = reply.json.sas ?? ''
        await saveApprovals()
        peer.approved = true
        peer.secret = reply.json.secret ?? ''
        outgoing.delete(peer.deviceId)
        log.info(`[remote-control] ${peer.deviceName} approved this device`)
        return
      }
      if (status === 'denied') {
        outgoing.delete(peer.deviceId)
        return
      }
    }
    outgoing.delete(peer.deviceId)
  }

  /* ---------------- inbound: authenticated peer calls ---------------- */

  async function handlePeer(req, res, url) {
    const pathname = url.pathname
    if (pathname === '/peer/hello' && req.method === 'POST') return createHello(req, res)
    const helloMatch = pathname.match(/^\/peer\/hello\/([0-9a-f]{32})$/)
    if (helloMatch && req.method === 'GET') return helloStatus(res, helloMatch[1])

    const verdict = verifyPeer(req, url)
    if (!verdict.ok) return json(res, 403, { error: verdict.error })
    if (!allowCall(verdict.deviceId)) return json(res, 429, { error: 'rate-limited' })
    const requiredScope = scopeFor(req.method || 'GET', pathname)
    if (requiredScope && Array.isArray(verdict.approval?.scopes) && !verdict.approval.scopes.includes(requiredScope)) {
      return json(res, 403, { error: 'scope-denied', scope: requiredScope })
    }
    if (!cipherCompatible(verdict.approval)) {
      return json(res, 409, { error: 'cipher-incompatible', message: 'This device and the peer share no encryption cipher; update both sides.' })
    }

    const viaHeader = String(req.headers['x-dsh-via'] || '')
    const fromRelay = viaHeader === 'relay' || viaHeader === 'p2p'
    // A pinned peer on the direct transport must use the sealed lane; relay
    // traffic is already inside the relay AEAD envelope.
    let lanePair
    // /peer/rehandshake bootstraps a fresh lane precisely when the old one is
    // stale, so it is signature-authenticated but deliberately unsealed.
    if (!fromRelay && verdict.approval?.publicKey && pathname !== '/peer/stream' && pathname !== '/peer/rehandshake') {
      if (String(req.headers['x-dsh-lane'] || '') !== 'sealed') {
        return json(res, 403, { error: 'plaintext-not-allowed' })
      }
      lanePair = lanCipherFor(verdict.deviceId)
      if (!lanePair) return json(res, 403, { error: 'no-channel' })
    }
    // One body read for every authenticated POST: the peer may have sealed it
    // with the LAN channel, and every route needs the same decoded value.
    let body = {}
    if (req.method === 'POST') {
      let incoming
      try {
        incoming = await readJson(req, UPLOAD_BODY_BYTES)
      } catch {
        return json(res, 400, { error: 'bad-body' })
      }
      if (incoming && typeof incoming === 'object' && typeof incoming.enc === 'string') {
        if (!lanePair) return json(res, 403, { error: 'no-channel' })
        try {
          const opened = openLaneBody(verdict.deviceId, incoming.enc, lanePair)
          body = opened.body
          lanePair = opened.pair
        } catch (error) {
          return json(res, 403, { error: 'bad-envelope' })
        }
      } else {
        body = incoming ?? {}
      }
    }
    const reply = lanePair
      ? (status, value) => json(res, status, { enc: lanePair.seal(JSON.stringify(value)) })
      : (status, value) => json(res, status, value)

    if (pathname.startsWith('/peer/upload/') && uploads) {
      const action = pathname.slice('/peer/upload/'.length)
      const handler = uploads[action]
      if (typeof handler !== 'function') return reply(404, { error: 'not-found' })
      const payload = req.method === 'GET' ? Object.fromEntries(url.searchParams.entries()) : body
      const result = await handler(payload)
      return reply(result.status ?? 200, result)
    }
    if (pathname === '/peer/rehandshake' && req.method === 'POST') {
      const peerMessage = body?.ephemeral
      const mine = approvals.get(verdict.deviceId)
      if (!peerMessage || !verifyEphemeral(mine?.publicKey ?? '', verdict.deviceId, self().pairCode ?? '', peerMessage)) {
        return reply(400, { error: 'bad-handshake' })
      }
      const replyMessage = mintFor(verdict.deviceId, self().pairCode ?? '')
      approvals.set(verdict.deviceId, { ...mine, peerEphemeral: peerMessage.publicPem })
      ciphers.delete(verdict.deviceId)
      for (const key of [...lanCiphers.keys()]) {
        if (key.endsWith(`:${verdict.deviceId}`)) lanCiphers.delete(key)
      }
      await saveApprovals()
      // Plaintext reply: the caller could not open a sealed one if its lane was stale.
      return json(res, 200, { ok: true, ephemeral: replyMessage })
    }
    if (pathname === '/peer/session/config' && req.method === 'GET') {
      const sessionId = String(url.searchParams.get('sessionId') || '')
      if (!sessionId) return reply(400, { error: 'missing-session' })
      if (typeof sessions.config !== 'function') return reply(503, { error: 'config-unavailable' })
      return reply(200, await sessions.config(sessionId))
    }
    if (pathname === '/peer/session/config' && req.method === 'POST') {
      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
      if (!sessionId) return reply(400, { error: 'missing-session' })
      if (typeof sessions.applyConfig !== 'function') return reply(503, { error: 'config-unavailable' })
      return reply(200, await sessions.applyConfig(sessionId, body))
    }
    if (pathname === '/peer/sessions' && req.method === 'GET') {
      const value = await sessions.list()
      return reply(200, { items: value.map((item) => ({ ...item, title: item.title })) })
    }
    if (pathname === '/peer/stream' && req.method === 'GET') {
      return streamSession(req, res, url)
    }
    if (pathname === '/peer/prompt' && req.method === 'POST') {
      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
      const text = typeof body?.text === 'string' ? body.text : ''
      const attachments = Array.isArray(body?.attachments) ? body.attachments : []
      if (!sessionId || (!text.trim() && attachments.length === 0)) return reply(400, { error: 'bad-request' })
      const value = await sessions.prompt(sessionId, { text, attachments, mode: body?.mode })
      return reply(200, value)
    }
    if (pathname === '/peer/hitl' && req.method === 'GET') {
      const bridge = typeof hitl === 'function' ? hitl() : hitl
      const sessionId = String(url.searchParams.get('sessionId') || '')
      if (!bridge?.pendingFor) return reply(503, { error: 'hitl-unavailable' })
      if (!sessionId) return reply(400, { error: 'missing-session' })
      return reply(200, { items: bridge.pendingFor(sessionId) })
    }
    if (pathname === '/peer/hitl/answer' && req.method === 'POST') {
      const bridge = typeof hitl === 'function' ? hitl() : hitl
      if (!bridge?.answer) return reply(503, { error: 'hitl-unavailable' })
      const requestId = String(body?.requestId || '')
      if (!requestId) return reply(400, { error: 'missing-request' })
      const accepted = bridge.answer(requestId, body)
      // A stale card (already answered elsewhere) is a conflict, not a failure.
      return accepted ? reply(200, { ok: true }) : reply(409, { error: 'stale-request' })
    }
    if (pathname === '/peer/history' && req.method === 'GET') {
      if (typeof sessions.history !== 'function') return reply(503, { error: 'history-unavailable' })
      const sessionId = String(url.searchParams.get('sessionId') || '')
      if (!sessionId) return reply(400, { error: 'missing-session' })
      const before = Number(url.searchParams.get('before'))
      const max = Number(url.searchParams.get('max'))
      try {
        return reply(200, await sessions.history(sessionId, before, max))
      } catch (error) {
        return reply(500, { error: 'history-failed', message: error?.message || String(error) })
      }
    }
    if (pathname === '/peer/new-session' && req.method === 'POST') {
      if (typeof sessions.createSession !== 'function') return reply(503, { error: 'session-create-unavailable' })
      try {
        return reply(200, await sessions.createSession(body))
      } catch (error) {
        return reply(500, { error: 'session-create-failed', message: error?.message || String(error) })
      }
    }
    if (pathname === '/peer/state' && req.method === 'GET') {
      const sessionId = String(url.searchParams.get('sessionId') || '')
      if (!sessionId) return reply(400, { error: 'missing-session' })
      if (typeof sessions.state !== 'function') return reply(503, { error: 'state-unavailable' })
      return reply(200, await sessions.state(sessionId))
    }
    if (pathname === '/peer/queue' && req.method === 'POST') {
      if (typeof sessions.updateQueue !== 'function') return reply(503, { error: 'queue-unavailable' })
      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
      const itemId = typeof body?.itemId === 'string' ? body.itemId : ''
      const kind = body?.action?.kind ?? body?.kind
      if (!sessionId || !itemId) return reply(400, { error: 'missing-queue-item' })
      if (kind !== 'steer' && kind !== 'remove') return reply(400, { error: 'bad-action' })
      try {
        return reply(200, (await sessions.updateQueue(sessionId, itemId, kind)) ?? { accepted: true })
      } catch (error) {
        return reply(409, { error: 'queue-update-failed', message: error?.message || String(error) })
      }
    }
    if (pathname === '/peer/attachment' && req.method === 'GET') {
      // Base64 in JSON: the peer channel is JSON end to end, and an 8 MB cap
      // keeps a phone page from waiting on a huge image.
      if (typeof readAttachment !== 'function') return reply(503, { error: 'attachments-unavailable' })
      const raw = String(url.searchParams.get('ref') || '')
      if (!raw) return reply(400, { error: 'missing-ref' })
      let ref
      try { ref = JSON.parse(raw) } catch { return reply(400, { error: 'bad-ref' }) }
      if (!ref || typeof ref !== 'object' || typeof ref.attachmentId !== 'string') return reply(400, { error: 'bad-ref' })
      const stored = await readAttachment(ref)
      if (!stored || !stored.bytes) return reply(404, { error: 'not-found' })
      const bytes = Buffer.from(stored.bytes)
      if (bytes.length > 8 * 1024 * 1024) return reply(413, { error: 'attachment-too-large' })
      return reply(200, { mediaType: stored.mediaType || ref.mediaType || 'application/octet-stream', data: bytes.toString('base64') })
    }
    if (pathname === '/peer/cancel' && req.method === 'POST') {
      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
      if (!sessionId) return reply(400, { error: 'bad-request' })
      return reply(200, sessions.cancel(sessionId))
    }
    return reply(404, { error: 'not-found' })
  }

  function verifyPeer(req, url) {
    const deviceId = String(req.headers['x-dsh-peer-id'] || '')
    const timestamp = String(req.headers['x-dsh-peer-ts'] || '')
    const signature = String(req.headers['x-dsh-peer-sig'] || '')
    if (!deviceId || !timestamp || !signature) return { ok: false, error: 'missing-signature' }
    const approval = approvals.get(deviceId)
    if (!approval) return { ok: false, error: 'unapproved-device' }
    if (!/^\d{1,16}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > CLOCK_SKEW_MS) {
      return { ok: false, error: 'stale-signature' }
    }
    // A pinned device key retires the shared secret: the approval response that
    // carried that secret crossed the relay in plaintext, so accepting HMAC
    // afterwards would let anyone who saw it forge calls.
    if (approval.publicKey && String(req.headers['x-dsh-peer-alg'] || '') !== 'ed25519') {
      return { ok: false, error: 'legacy-auth-disabled' }
    }
    if (String(req.headers['x-dsh-peer-alg'] || '') === 'ed25519') {
      if (!approval.publicKey) return { ok: false, error: 'no-device-key' }
      const nonce = String(req.headers['x-dsh-peer-nonce'] || '')
      if (!nonce) return { ok: false, error: 'missing-nonce' }
      const payload = `${deviceId}\n${req.method || 'GET'}\n${url.pathname + url.search}\n${timestamp}\n${nonce}`
      if (!verifyPayload(approval.publicKey, payload, signature)) return { ok: false, error: 'bad-signature' }
      if (!acceptNonce(deviceId, nonce)) return { ok: false, error: 'replayed' }
      return { ok: true, deviceId, approval }
    }
    const expected = sign(approval.secret, deviceId, req.method || 'GET', url.pathname + url.search, timestamp, '')
    const actual = Buffer.from(signature, 'hex')
    const wanted = Buffer.from(expected, 'hex')
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return { ok: false, error: 'bad-signature' }
    return { ok: true, deviceId, approval }
  }

  async function streamSession(req, res, url) {
    const sessionId = String(url.searchParams.get('sessionId') || '')
    if (!sessionId) return json(res, 400, { error: 'missing-session' })
    // Frames use their own key space, so a stream can never desync the unary
    // body counters.
    const peerDeviceId = String(req.headers['x-dsh-peer-id'] || '')
    const streamPair = String(req.headers['x-dsh-lane'] || '') === 'sealed' && peerDeviceId
      ? lanCipherFor(peerDeviceId, 'lan-stream')
      : undefined
    const controller = new AbortController()
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    res.write(': connected\n\n')
    const heartbeat = setInterval(() => { try { res.write(': ping\n\n') } catch { /* ignore */ } }, 15000)
    heartbeat.unref?.()
    let closed = false
    const cleanup = () => {
      if (closed) return
      closed = true
      clearInterval(heartbeat)
      try { controller.abort() } catch { /* ignore */ }
      try { res.end() } catch { /* ignore */ }
    }
    req.on('close', cleanup)
    req.on('aborted', cleanup)
    try {
      for await (const frame of sessions.follow(sessionId, controller.signal)) {
        if (res.writableEnded || res.destroyed) break
        const payload = JSON.stringify(frame)
        const wire = streamPair ? JSON.stringify({ enc: streamPair.seal(payload) }) : payload
        res.write(`data: ${wire}\n\n`)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        try {
          res.write(`data: ${JSON.stringify({ type: 'remote-error', code: error?.code ?? 'error', message: error?.message ?? String(error) })}\n\n`)
        } catch { /* ignore */ }
      }
    } finally {
      cleanup()
    }
  }

  /* ---------------- outbound: control a peer ---------------- */

  /**
   * One signed call to a peer over whichever transport reaches it: the relay
   * when the peer was discovered there, direct HTTP for a LAN peer.
   */
  const routeBlocks = new Map() // deviceId -> { lanUntil, p2pUntil, lastError }

  function laneBlocked(deviceId, lane) {
    const entry = routeBlocks.get(deviceId)
    if (!entry) return false
    return (lane === 'lan' ? entry.lanUntil : entry.p2pUntil) > Date.now()
  }

  function markLaneBlocked(deviceId, lane, reason) {
    let entry = routeBlocks.get(deviceId)
    if (!entry) { entry = { lanUntil: 0, p2pUntil: 0 }; routeBlocks.set(deviceId, entry) }
    const holdMs = config.routeBlockMs ?? 60_000
    if (lane === 'lan') entry.lanUntil = Date.now() + holdMs
    else entry.p2pUntil = Date.now() + holdMs
    entry.lastError = String(reason ?? 'unreachable')
    log.warn(`[remote-control] ${lane} route to ${deviceId} parked for ${holdMs}ms: ${entry.lastError}`)
  }

  function markLaneHealthy(deviceId, lane) {
    const entry = routeBlocks.get(deviceId)
    if (!entry) return
    if (lane === 'lan') entry.lanUntil = 0
    else entry.p2pUntil = 0
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(undefined), ms)
      timer.unref?.()
      promise.then(
        (value) => { clearTimeout(timer); resolve(value) },
        () => { clearTimeout(timer); resolve(undefined) },
      )
    })
  }

  /** Resolve with the first non-undefined value; undefined when all fail. */
  function firstSuccess(promises) {
    return new Promise((resolve) => {
      let pending = promises.length
      let settled = false
      for (const promise of promises) {
        promise.then(
          (value) => {
            if (settled) return
            if (value) { settled = true; resolve(value); return }
            pending -= 1
            if (pending === 0) resolve(undefined)
          },
          () => {
            if (settled) return
            pending -= 1
            if (pending === 0) resolve(undefined)
          },
        )
      }
    })
  }

  async function peerCall(peer, method, pathname, body, secret, options = {}) {
    const deviceId = peer.deviceId
    const approval = approvals.get(deviceId)
    const bodySize = body === undefined ? 0 : JSON.stringify(body).length
    const started = Date.now()
    const relayAvailable = Boolean(relay)
    const directParked = laneBlocked(deviceId, 'lan')
    const p2pParked = laneBlocked(deviceId, 'p2p')

    const finish = (result, lane) => {
      const elapsed = Date.now() - started
      peer.lastTransport = lane
      peer.lastTiming = { lane, ms: elapsed, at: Date.now() }
      log.info(`[remote-control] ${method} ${pathname} ${deviceId} via ${lane} in ${elapsed}ms`)
      return result
    }

    const viaRelayLane = () => relayCall(peer, method, pathname, body, secret)

    const viaP2p = async () => {
      if (!p2pNode || !approval?.punch || bodySize > 64 * 1024 || laneBlocked(deviceId, 'p2p')) return undefined
      const auth = authHeaders(deviceId, method, pathname) ?? {}
      const result = await withTimeout(p2pNode.request(
        { address: approval.punch.address, port: approval.punch.port },
        deviceId,
        {
          method,
          path: pathname,
          headers: { ...auth, accept: 'application/json', 'content-type': 'application/json' },
          bodyText: body === undefined ? '' : JSON.stringify(body),
        },
      ), config.p2pTimeoutMs ?? 800)
      if (!result?.ok) {
        markLaneBlocked(deviceId, 'p2p', result?.error ?? 'p2p-timeout')
        return undefined
      }
      markLaneHealthy(deviceId, 'p2p')
      let json = {}
      try { json = result.message.bodyText ? JSON.parse(result.message.bodyText) : {} } catch { json = {} }
      return { ok: result.message.status >= 200 && result.message.status < 300, status: result.message.status, json }
    }

    const viaDirect = async () => {
      const auth = authHeaders(deviceId, method, pathname)
      const pair = lanCipherFor(deviceId)
      const lane = pair
        ? { seal: (value) => pair.seal(value), open: (packet) => pair.open(packet).toString('utf8') }
        : undefined
      const result = await callDirect(
        peer, method, pathname, body, secret, self().deviceId, auth, lane,
        config.directTimeoutMs ?? 1000,
      )
      if (!result.error) {
        markLaneHealthy(deviceId, 'lan')
        return result
      }
      markLaneBlocked(deviceId, 'lan', result.error)
      return result
    }

    // Happy-eyeballs for idempotent reads: the relay and the direct lane start
    // together and the first answer wins. Never used for writes, so a prompt
    // can still execute exactly once.
    if (options.race && relayAvailable && peer.proto !== 'relay' && !directParked && !p2pParked) {
      const auth = authHeaders(deviceId, method, pathname)
      const pair = lanCipherFor(deviceId)
      const lane = pair
        ? { seal: (value) => pair.seal(value), open: (packet) => pair.open(packet).toString('utf8') }
        : undefined
      const directPromise = callDirect(
        peer, method, pathname, body, secret, self().deviceId, auth, lane,
        config.directTimeoutMs ?? 1000,
      ).then((result) => {
        if (result.error) { markLaneBlocked(deviceId, 'lan', result.error); return undefined }
        markLaneHealthy(deviceId, 'lan')
        return { lane: 'lan', result }
      }, () => undefined)
      const relayPromise = relayCall(peer, method, pathname, body, secret)
        // A relay-level failure (unknown peer 404, timeout 504, 502) must not win
        // the race: it answers in ~1ms and would beat the real direct lane every
        // time. Only a peer-level answer counts as a relay success.
        .then((result) => ((result.ok || PEER_LEVEL_STATUS.has(result.status)) ? { lane: 'relay', result } : undefined), () => undefined)
      const winner = await firstSuccess([directPromise, relayPromise])
      if (winner) return finish(winner.result, winner.lane)
    }

    // Relay-first once a direct lane is known blocked: only the first call pays
    // the discovery penalty. A fresh announce clears the block again.
    if (relayAvailable && peer.proto !== 'relay' && (directParked || p2pParked)) {
      const relayed = await viaRelayLane()
      if (relayed.ok || relayed.status !== 503) return finish(relayed, 'relay')
      const fallback = await viaDirect()
      if (!fallback.error) return finish(fallback, 'lan')
      return finish(relayed, 'relay')
    }

    const datagram = await viaP2p()
    if (datagram) return finish(datagram, 'p2p')
    if (peer.proto !== 'relay') {
      const direct = await viaDirect()
      if (!direct.error) return finish(direct, 'lan')
      if (relayAvailable) {
        const relayed = await viaRelayLane()
        if (relayed.ok || relayed.status !== 503) return finish(relayed, 'relay')
      }
      return finish(direct, 'lan')
    }
    return finish(await viaRelayLane(), 'relay')
  }

  async function relayCall(peer, method, pathname, body, secret) {
    if (!relay) return { ok: false, status: 503, json: { error: 'relay-offline' } }
    // A peer that pinned an identity key but has no agreement key would send
    // plaintext through the relay: that is a silent downgrade, so refuse it
    // unless the operator opted in explicitly.
    const approvalForCrypto = approvals.get(peer.deviceId)
    if (approvalForCrypto?.publicKey && !approvalForCrypto?.agreementKey && config.allowPlaintextFallback !== true) {
      log.warn(`[remote-control] refusing plaintext relay call to ${peer.deviceId}: no agreement key`)
      return {
        ok: false,
        status: 403,
        json: { error: 'plaintext-refused', message: 'This peer pinned an identity but no encryption key; approve it again to enable encryption.' },
      }
    }
    if (!cipherCompatible(approvalForCrypto)) {
      return { ok: false, status: 409, json: { error: 'cipher-incompatible', message: 'This device and the peer share no encryption cipher; update both sides.' } }
    }
    peer.lastTransport = 'relay'
    const callerId = self().deviceId
    const timestamp = String(Date.now())
    const headers = { accept: 'application/json' }
    const relayAuth = authHeaders(peer.deviceId, method, pathname)
    if (relayAuth) {
      Object.assign(headers, relayAuth)
    } else if (secret) {
      headers['x-dsh-peer-id'] = callerId
      headers['x-dsh-peer-ts'] = timestamp
      headers['x-dsh-peer-sig'] = sign(secret, callerId, method, pathname, timestamp, '')
    }
    if (body !== undefined) headers['content-type'] = 'application/json'
    let reply
    try {
      reply = await relay.request(peer.deviceId, {
        method,
        path: pathname,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (error) {
      return { ok: false, status: 502, json: { error: 'relay-failed', message: error?.message ?? String(error) } }
    }
    let parsed
    try { parsed = reply.body ? JSON.parse(reply.body) : {} } catch { parsed = {} }
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: parsed }
  }

  async function callPeer(deviceId, method, pathname, body, options) {
    syncRelayPeers()
    const peer = peers.get(deviceId)
    if (!peer) return { ok: false, status: 404, json: { error: 'unknown-peer' } }
    const approval = approvals.get(deviceId)
    if (!approval) return { ok: false, status: 403, json: { error: 'not-approved' } }
    return peerCall(peer, method, pathname, body, approval.secret, options)
  }

  /** Relay one peer's SSE transcript to a local response (Devices panel). */
  function proxyStream(deviceId, sessionId, res) {
    syncRelayPeers()
    const peer = peers.get(deviceId)
    const approval = approvals.get(deviceId)
    if (!peer || !approval) {
      json(res, 404, { error: 'unknown-peer' })
      return
    }
    if (!cipherCompatible(approval)) {
      json(res, 409, { error: 'cipher-incompatible' })
      return
    }
    const target = `/peer/stream?sessionId=${encodeURIComponent(sessionId)}`
    const timestamp = String(Date.now())
    const callerId = self().deviceId
    const started = Date.now()
    // A parked direct route goes straight to the relay: the stream must never
    // hang waiting for headers a blocked LAN will not deliver.
    if (relay && peer.proto !== 'relay' && laneBlocked(deviceId, 'lan')) {
      relay.stream(peer.deviceId, {
        path: target,
        headers: {
          accept: 'text/event-stream',
          'x-dsh-peer-id': callerId,
          'x-dsh-peer-ts': timestamp,
          'x-dsh-peer-sig': sign(approval.secret, callerId, 'GET', target, timestamp, ''),
          ...(authHeaders(deviceId, 'GET', target) ?? {}),
        },
      }, res)
      peer.lastTiming = { lane: 'relay', ms: 0, at: Date.now(), reason: 'direct-parked' }
      return
    }
    if (config.p2pStreams !== false && p2pNode && approval.punch && !laneBlocked(deviceId, 'p2p')) {
      const auth = authHeaders(deviceId, 'GET', target) ?? {}
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      const handle = p2pNode.openStream(
        { address: approval.punch.address, port: approval.punch.port },
        deviceId,
        { path: target, headers: { ...auth, accept: 'text/event-stream' } },
        {
          onChunk: (chunk) => { try { res.write(chunk) } catch { /* client gone */ } },
          onEnd: () => { try { res.end() } catch { /* ignore */ } },
        },
      )
      if (!handle.ok) {
        markLaneBlocked(deviceId, 'p2p', 'stream-open-failed')
        try { res.destroy() } catch { /* ignore */ }
        return
      }
      peer.lastTransport = 'p2p'
      return
    }
    if (peer.proto === 'relay') {
      if (!relay) {
        json(res, 503, { error: 'relay-offline' })
        return
      }
      if (approval.publicKey && !approval.agreementKey && config.allowPlaintextFallback !== true) {
        log.warn(`[remote-control] refusing plaintext relay stream to ${deviceId}: no agreement key`)
        json(res, 403, { error: 'plaintext-refused' })
        return
      }
      relay.stream(peer.deviceId, {
        path: target,
        headers: {
          accept: 'text/event-stream',
          'x-dsh-peer-id': callerId,
          'x-dsh-peer-ts': timestamp,
          'x-dsh-peer-sig': sign(approval.secret, callerId, 'GET', target, timestamp, ''),
          ...(authHeaders(peer.deviceId, 'GET', target) ?? {}),
        },
      }, res)
      return
    }
    const streamPair = lanCipherFor(peer.deviceId, 'lan-stream')
    const streamAuth = authHeaders(peer.deviceId, 'GET', target)
    const streamHeaders = {
      accept: 'text/event-stream',
      'x-dsh-peer-id': callerId,
      'x-dsh-peer-ts': timestamp,
      'x-dsh-peer-sig': sign(approval.secret, callerId, 'GET', target, timestamp, ''),
      ...(streamAuth ?? {}),
    }
    if (streamPair) streamHeaders['x-dsh-lane'] = 'sealed'
    const upstreamTransport = peer.proto === 'https' ? https : http
    const upstream = upstreamTransport.request({
      host: peer.address,
      port: peer.port,
      path: target,
      method: 'GET',
      headers: streamHeaders,
    }, (response) => {
      responded = true
      clearTimeout(connectTimer)
      markLaneHealthy(deviceId, 'lan')
      peer.lastTiming = { lane: 'lan', ms: Date.now() - started, at: Date.now() }
      res.writeHead(response.statusCode ?? 502, {
        'content-type': response.headers['content-type'] || 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      if (!streamPair) {
        response.pipe(res)
        response.on('end', () => { try { res.end() } catch { /* ignore */ } })
        return
      }
      // Decrypt each sealed frame before handing it to the local client.
      response.setEncoding('utf8')
      let buffer = ''
      response.on('data', (chunk) => {
        buffer += chunk
        let index
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const event = buffer.slice(0, index)
          buffer = buffer.slice(index + 2)
          const line = event.split('\n').find((entry) => entry.startsWith('data: '))
          if (line) {
            try {
              const parsed = JSON.parse(line.slice(6))
              if (parsed && typeof parsed.enc === 'string') {
                let plain
                try {
                  plain = streamPair.open(parsed.enc)
                } catch {
                  plain = staticLaneCipher(peer.deviceId, 'lan-stream')?.open(parsed.enc)
                }
                if (plain) res.write(`data: ${plain.toString('utf8')}\n\n`)
                continue
              }
            } catch {
              continue
            }
          }
          res.write(`${event}\n\n`)
        }
      })
      response.on('end', () => { try { res.end() } catch { /* ignore */ } })
    })
    let responded = false
    const connectTimer = setTimeout(() => {
      if (!responded) upstream.destroy(new Error('stream-connect-timeout'))
    }, config.streamConnectTimeoutMs ?? 2500)
    connectTimer.unref?.()
    upstream.on('error', (error) => {
      clearTimeout(connectTimer)
      // Same fallback as peerCall: a blocked LAN route may still reach the
      // peer through the outbound relay.
      if (!responded) markLaneBlocked(deviceId, 'lan', error?.message || 'stream-failed')
      if (relay && !res.headersSent) {
        relay.stream(peer.deviceId, { path: target, headers: streamHeaders }, res)
        return
      }
      try { json(res, 502, { error: 'peer-unreachable' }) } catch { /* ignore */ }
    })
    res.on('close', () => {
      clearTimeout(connectTimer)
      try { upstream.destroy() } catch { /* ignore */ }
    })
    upstream.end()
  }

  // give the module-level transport code a way to rotate a stale lane
  rehandshakeHook = rehandshakePeer

  return {
    start,
    stop,
    connect,
    approveRequest,
    denyRequest,
    callPeer,
    proxyStream,
    handlePeer,
    rehandshake: rehandshakePeer,
    attemptPunch: punchPeer,
    // Diagnostics used by the latency tests and by the Devices panel tooling.
    simulateAnnounce(deviceId, address, port, proto = 'http', deviceName = '') {
      onAnnounce(
        { kind: ANNOUNCE_KIND, deviceId, deviceName: deviceName || `simulated-${deviceId}`, userId: null, port, proto, origin: 'tailnet' },
        { address },
      )
    },
    setPeerAddress(deviceId, address, port) {
      const peer = peers.get(deviceId)
      if (!peer) return false
      peer.address = address
      if (Number.isInteger(port)) peer.port = port
      return true
    },
    routeState(deviceId) {
      const entry = routeBlocks.get(deviceId)
      return entry ? { ...entry } : null
    },
    debugSetApproval(deviceId, patch) {
      const approval = approvals.get(deviceId)
      if (!approval) return false
      approvals.set(deviceId, { ...approval, ...patch })
      return true
    },
    async clearPunch(peerDeviceId) {
      const approval = approvals.get(peerDeviceId)
      if (!approval) return { ok: false, error: 'unknown-peer' }
      const next = { ...approval }
      delete next.punch
      approvals.set(peerDeviceId, next)
      await saveApprovals()
      return { ok: true }
    },
    setRelay(link) {
      relay = link
      if (link && typeof link.setSecurity === 'function') link.setSecurity(security)
      if (!link) {
        // Without a relay every relay-only peer is unreachable; keeping it
        // would make each call fail with a misleading 503.
        for (const [deviceId, peer] of peers) {
          if (peer.proto === 'relay') peers.delete(deviceId)
        }
      }
    },
    setScopes(deviceId, scopes) {
      const approval = approvals.get(deviceId)
      if (!approval) return { ok: false, error: 'unknown-device' }
      const next = Array.isArray(scopes) ? scopes.filter((scope) => DEFAULT_SCOPES.includes(scope)) : []
      approvals.set(deviceId, { ...approval, scopes: next })
      saveApprovals().catch(() => {})
      return { ok: true, scopes: next }
    },
    revoke(deviceId) {
      if (!approvals.delete(deviceId)) return { ok: false, error: 'unknown-device' }
      invalidatePeerChannels(deviceId)
      saveApprovals().catch(() => {})
      return { ok: true }
    },

    snapshot() {
      syncRelayPeers()
      const who = self()
      return {
        self: who,
        peers: [...peers.values()].map((peer) => ({
          deviceId: peer.deviceId,
          deviceName: peer.deviceName,
          userId: peer.userId,
          address: peer.address,
          port: peer.port,
          lastSeen: peer.lastSeen,
          approved: approvals.has(peer.deviceId),
          connecting: outgoing.has(peer.deviceId),
          transport: peer.proto === 'relay' ? 'relay' : 'lan',
          relay: approvals.get(peer.deviceId)?.relay ?? '',
          fingerprint: approvals.get(peer.deviceId)?.fingerprint ?? '',
          forwardSecrecy: Boolean(approvals.get(peer.deviceId)?.peerEphemeral && ephemerals.has(peer.deviceId)),
          lane: peer.lastTransport === 'relay'
            ? 'relay'
            : selectLane({ sameLan: peer.proto !== 'relay', punched: Boolean(approvals.get(peer.deviceId)?.punch), relayAvailable: Boolean(relay) }),
          // Report the stable route rather than the lane of the last call: a
          // tailnet peer must not be labelled "lan" just because the last
          // attempt took the local path.
          transport: peer.proto === 'relay' ? 'relay' : (peer.origin === 'tailnet' ? 'tailnet' : (peer.lastTransport ?? 'lan')),
          origin: peer.origin === 'tailnet' ? 'tailnet' : 'lan',
          candidates: Array.isArray(peer.candidates) ? peer.candidates.map((entry) => entry.origin + ':' + entry.address + ':' + entry.port) : [],
          timing: peer.lastTiming ?? null,
          blocked: { lan: laneBlocked(peer.deviceId, 'lan'), p2p: laneBlocked(peer.deviceId, 'p2p') },
          // A legacy record can carry only the shared secret and no identity
          // keys at all; that is exactly as unusable as a missing agreement key.
          needsReapproval: Boolean(!approvals.get(peer.deviceId)?.publicKey || !approvals.get(peer.deviceId)?.agreementKey),
          punch: approvals.get(peer.deviceId)?.punch ?? null,
          candidates: (() => {
            const merged = Array.isArray(peer.candidates) ? [...peer.candidates] : []
            if (!merged.some((entry) => entry && entry.address === peer.address && entry.port === peer.port)) {
              merged.unshift({ origin: peer.origin === 'tailnet' ? 'tailnet' : 'lan', address: peer.address, port: peer.port })
            }
            return merged.filter((entry) => entry && entry.address).map((entry) => (entry.origin === 'tailnet' ? 'tailnet' : 'lan') + ':' + entry.address + ':' + entry.port)
          })(),
          punchPort: peer.punchPort ?? 0,
          sas: approvals.get(peer.deviceId)?.sas ?? '',
          scopes: approvals.get(peer.deviceId)?.scopes ?? [],
          ciphers: approvals.get(peer.deviceId)?.ciphers ?? [],
        })),
        requests: [...requests.values()]
          .filter((request) => request.status === 'pending')
          .map((request) => ({
            requestId: request.requestId,
            deviceId: request.deviceId,
            deviceName: request.deviceName,
            userId: request.userId,
            at: request.at,
            relay: request.relay ?? '',
            pairCode: request.pairCode ?? '',
            sas: request.sas ?? '',
            fingerprint: request.fingerprint ?? '',
            relayChanged: Boolean(request.relayChanged),
          })),
      }
    },
  }
}

/* ---------------- HTTP helpers ---------------- */

function sign(secret, deviceId, method, pathname, timestamp, body) {
  return createHmac('sha256', secret)
    .update(`${deviceId}\n${method}\n${pathname}\n${timestamp}\n${body}`)
    .digest('hex')
}

/**
 * A direct call with one retry on the peer's other known address. The announce
 * seen last is not always the reachable one (LAN vs tailnet), so a failed
 * attempt rotates the candidate instead of failing the whole call.
 */
async function callDirect(peer, method, pathname, body, secret, callerId, extraHeaders, lane, timeoutMs, allowHeal = true) {
  const first = await callRaw(peer, method, pathname, body, secret, callerId, extraHeaders, lane, timeoutMs)
  // A lane can go stale when the peer restarted and forgot its ephemeral key.
  // Rotate it over the unsealed handshake and retry once before giving up.
  if (allowHeal && (first?.error === 'bad-envelope' || first?.json?.error === 'bad-envelope')) {
    const healed = typeof rehandshakeHook === 'function'
      ? await rehandshakeHook(peer.deviceId).catch(() => undefined)
      : undefined
    if (healed?.ok) {
      return await callRaw(peer, method, pathname, body, secret, callerId, extraHeaders, lane, timeoutMs)
    }
  }
  if (!first?.error || !Array.isArray(peer.candidates) || peer.candidates.length < 2) return first
  for (const candidate of peer.candidates) {
    if (!candidate || typeof candidate.address !== 'string') continue
    if (candidate.address === peer.address && candidate.port === peer.port) continue
    const alternative = {
      ...peer,
      address: candidate.address,
      port: candidate.port,
      proto: candidate.proto === 'https' ? 'https' : 'http',
      origin: candidate.origin === 'tailnet' ? 'tailnet' : 'lan',
    }
    const retry = await callRaw(alternative, method, pathname, body, secret, callerId, extraHeaders, lane, timeoutMs)
    if (!retry?.error) {
      const current = peers.get(peer.deviceId)
      if (current) peers.set(peer.deviceId, { ...current, address: alternative.address, port: alternative.port, proto: alternative.proto, origin: alternative.origin })
      return retry
    }
  }
  return first
}

function callRaw(peer, method, pathname, body, secret, callerId, extraHeaders, lane, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let text = body === undefined ? '' : JSON.stringify(body)
    if (lane && body !== undefined) {
      try {
        text = JSON.stringify({ enc: lane.seal(text) })
      } catch (error) {
        // A pinned peer with an unusable cipher must fail clearly instead of
        // silently sending plaintext on the sealed lane.
        return resolve({ ok: false, error: 'cipher-incompatible', json: { error: 'cipher-incompatible', message: String(error?.message || error) } })
      }
    }
    const headers = { accept: 'application/json' }
    if (text) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = Buffer.byteLength(text)
    }
    if (extraHeaders) {
      Object.assign(headers, extraHeaders)
      if (lane) headers['x-dsh-lane'] = 'sealed'
    } else if (secret && callerId) {
      const timestamp = String(Date.now())
      headers['x-dsh-peer-id'] = callerId
      headers['x-dsh-peer-ts'] = timestamp
      headers['x-dsh-peer-sig'] = sign(secret, callerId, method, pathname, timestamp, '')
    }
    // A peer announced over https (a tailnet name with a certificate) is a real
    // direct lane, not a tunnel: speak TLS to it instead of refusing.
    const transport = peer.proto === 'https' ? https : http
    const req = transport.request({
      host: peer.address,
      port: peer.port,
      path: pathname,
      method,
      headers,
      timeout: timeoutMs,
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        let parsed
        try { parsed = data ? JSON.parse(data) : {} } catch { parsed = {} }
        if (lane && parsed && typeof parsed.enc === 'string') {
          try { parsed = JSON.parse(lane.open(parsed.enc)) } catch { parsed = { error: 'bad-envelope' } }
        }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: parsed })
      })
    })
    req.on('timeout', () => { req.destroy(new Error('timeout')) })
    req.on('error', (error) => resolve({ ok: false, error: error?.message || 'request-failed', json: {} }))
    req.end(text || undefined)
  })
}

function readJson(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers?.['content-length'])
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(new Error('too large'))
      req.destroy()
      return
    }
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) { reject(new Error('too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) return resolve({})
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (error) { reject(error) }
    })
    req.on('error', reject)
  })
}

function json(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function createFileStore(file, log) {
  return {
    async load() {
      try { return JSON.parse(await readFile(file, 'utf8')) } catch (error) {
        if (error?.code !== 'ENOENT') log.warn(`[remote-control] could not read ${file}: ${error?.message || error}`)
        return null
      }
    },
    async save(value) {
      try {
        await mkdir(path.dirname(file), { recursive: true })
        await writeFile(file, JSON.stringify(value, null, 2), { mode: 0o600 })
      } catch (error) {
        log.warn(`[remote-control] could not persist ${file}: ${error?.message || error}`)
      }
    },
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

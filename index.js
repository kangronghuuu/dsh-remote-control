import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, realpath, stat as statOf, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { isIP } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFabric } from './host/fabric.js'
import { createRelayLink } from './host/relay-link.js'
import { createRelay } from './host/relay-core.js'
import { checkRelayUrl, ensureReachable } from './host/reachability.js'
import { qrSvg } from './host/qr.js'
import { createServiceManager, normalizeServiceConfig } from './host/service.js'
import { createTunnelProvisioner } from './host/tunnel-provision.js'
import { createUploadManager } from './host/uploads.js'
import { createHitl } from './host/hitl.js'
import { createNotifier, normalizeNotify, verifyAction } from './host/notify.js'
import { loadOrCreateIdentity } from './host/identity.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB_DIR = path.join(HERE, 'web')
const COOKIE_NAME = 'dsh_rc'
const MAX_BODY_BYTES = 1024 * 1024
/** Messages included in a page's opening snapshot; the default tail is much shorter. */
const HISTORY_MESSAGES = 400
/** Inline text preview cap for `/api/file`; larger files still download raw. */
const FILE_TEXT_LIMIT = 200_000
const IMAGE_KINDS = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
}
/** Upload chunks carry base64, so their JSON bodies legitimately exceed MAX_BODY_BYTES. */
const UPLOAD_BODY_BYTES = 4 * 1024 * 1024
const UPLOAD_ACTIONS = new Set(['init', 'chunk', 'status', 'commit', 'cancel'])

const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
}

export const inject = ['sessionController']

/**
 * Phone-friendly remote control for this Host's Sessions.
 *
 * The plugin owns its own listener instead of reusing the loopback web
 * carrier, so it never depends on the GUI's boot payload, cookies, or the
 * `/api` bridge. Everything it renders is derived from
 * `ctx.sessionController` (list / follow / prompt / cancel / create).
 */
export function apply(ctx, rawConfig) {
  const log = pickLogger(ctx)
  const config = normalizeConfig(rawConfig)
  const stateFile = path.join(dshHome(), 'remote-control.json')
  // Settings the app never rewrites. The Desktop app regenerates the profile's
  // cordis.patch.yml on startup and drops rows it does not own, so anything that
  // must survive a restart lives here instead (see applySettingsOverrides).
  const settingsFile = path.join(dshHome(), 'remote-control-settings.json')
  applySettingsOverrides(config, readSettingsFile(settingsFile, log))
  const peersFile = path.join(dshHome(), 'remote-control-peers.json')
  const identityFile = path.join(dshHome(), 'remote-control-identity.json')
  const streams = new Set()
  const streamClients = new Map() // sessionId -> Set<ServerResponse> for HITL fan-out
  const published = { urls: [], code: '' }
  const info = { port: config.port, proto: config.tls ? 'https' : 'http' }
  const identity = { userId: null }

  let server
  let state
  let fabric
  let relayLink
  let relayCore
  let deviceIdentity
  let hostedKey = ''
  let hostedPairCode = ''
  let notifier
  let joinPairCode = ''

  const sessions = {
    async list() {
      const value = await ctx.sessionController.list({}, AbortSignal.timeout(15000))
      return (value?.items ?? [])
        .filter((item) => item.origin !== 'subagent')
        .map((item) => {
          const projections = item.projections?.values ?? {}
          const title = firstString(projections.title, projections.sessionTitle, projections['session-title'])
          return {
            id: item.sessionId,
            title: title || '',
            running: Boolean(item.running),
            blank: Boolean(item.blank),
            updatedAt: item.updatedAt ?? 0,
            cwd: item.cwd ?? '',
          }
        })
        .sort((a, b) => b.updatedAt - a.updatedAt)
    },
    follow(sessionId, signal) {
      return ctx.sessionController.follow(
        {
          address: { kind: 'session', sessionId },
          assistantStream: true,
          // The opening snapshot is bounded by these; without them the page only
          // receives a short tail of the transcript.
          maxMessages: HISTORY_MESSAGES,
        },
        signal,
      )
    },
    async prompt(sessionId, input) {
      const text = typeof input === 'string' ? input : String(input?.text ?? '')
      const mode = input?.mode === 'steer' ? 'steer' : 'queue'
      const requested = typeof input === 'object' && Array.isArray(input?.attachments) ? input.attachments : []
      const parts = []
      if (text.trim()) parts.push({ type: 'text', text })
      for (const item of requested) {
        if (!item || typeof item !== 'object') continue
        if (item.type === 'image' || item.type === 'file') {
          if (item.attachment && typeof item.attachment === 'object') parts.push({ type: item.type, attachment: item.attachment })
        }
      }
      if (parts.length === 0) throw new Error('empty prompt')
      // Admit through the attachment service so encoded images are normalized
      // and durable references pass unchanged.
      const attachments = typeof ctx.get === 'function' ? safely(() => ctx.get('attachments')) : undefined
      const content = attachments && typeof attachments.admitPromptContent === 'function'
        ? await attachments.admitPromptContent(parts)
        : parts
      return ctx.sessionController.prompt({
        requestId: randomUUID(),
        sessionId,
        mode,
        content,
        clientTimeZone: timeZone(),
      }, AbortSignal.timeout(30000))
    },
    cancel(sessionId) {
      return ctx.sessionController.cancel({ sessionId })
    },
    /**
     * Read a session's live configuration. Never resumes a cold session: a
     * remote read must not have side effects on the target.
     */
    async config(sessionId) {
      const out = { sessionId }
      // Cordis throws when a service is read as a property without `inject`,
      // so every optional service is reached through ctx.get inside a guard.
      let liveSession
      let agent
      try { liveSession = ctx.get?.('sessions')?.get?.(sessionId) } catch { /* not injected */ }
      try { agent = ctx.get?.('agents')?.get?.(sessionId) } catch { /* not injected */ }
      out.live = Boolean(liveSession)
      out.running = Boolean(agent)

      try {
        const catalog = await ctx.sessionController.modelCatalog()
        out.models = (catalog?.groups ?? []).map((group) => ({
          provider: group.id,
          name: group.name,
          models: (group.models ?? []).map((model) => ({ id: model.id, name: model.name })),
        }))
      } catch { /* catalog unavailable */ }

      try {
        const projections = await ctx.sessionController.projections({ sessionId })
        const current = projections?.values?.modelSelection
        if (current) out.model = { provider: current.provider, model: current.model, reasoningEffort: current.reasoningEffort }
      } catch { /* no projection */ }

      try {
        const presets = ctx.get?.('permissionPresets')
        if (presets) {
          out.permission = {
            current: liveSession ? presets.current(liveSession) : null,
            catalog: presets.catalog(),
          }
        }
      } catch { /* permission presets unavailable */ }

      try {
        const plan = ctx.get?.('planMode')
        if (plan && agent) out.plan = plan.get(agent)
      } catch { /* plan mode unavailable */ }

      return out
    },
    /** Apply model / permission / plan to a peer session, resuming it if cold. */
    async applyConfig(sessionId, patch) {
      if (!patch || typeof patch !== 'object') return { ok: false, error: 'bad-request' }
      const applied = {}
      const failures = []

      if (patch.model && typeof patch.model.provider === 'string' && typeof patch.model.model === 'string') {
        try {
          const selection = { provider: patch.model.provider, model: patch.model.model }
          if (typeof patch.model.reasoningEffort === 'string') selection.reasoningEffort = patch.model.reasoningEffort
          const result = await ctx.sessionController.selectModel({ sessionId, ...selection })
          applied.model = result?.selected ?? selection
        } catch (error) {
          failures.push(`model: ${error?.message || error}`)
        }
      }

      const needsLive = typeof patch.permission === 'string' || typeof patch.plan === 'boolean'
      if (needsLive) {
        let agent
        let session
        try { agent = ctx.get?.('agents')?.get?.(sessionId) } catch { /* not injected */ }
        if (!agent) {
          try {
            const resolved = await ctx.sessionController.resolveAgent(sessionId)
            agent = resolved?.agent
          } catch (error) {
            failures.push(`resume: ${error?.message || error}`)
          }
        }
        try { session = ctx.get?.('sessions')?.get?.(sessionId) } catch { /* not injected */ }

        if (typeof patch.permission === 'string') {
          try {
            const presets = ctx.get?.('permissionPresets')
            if (!presets || !session) throw new Error('permission presets unavailable')
            presets.set(session, patch.permission)
            applied.permission = patch.permission
          } catch (error) {
            failures.push(`permission: ${error?.message || error}`)
          }
        }

        if (typeof patch.plan === 'boolean') {
          try {
            const plan = ctx.get?.('planMode')
            if (!plan || !agent) throw new Error('plan mode unavailable')
            applied.plan = plan.set(agent, patch.plan)
          } catch (error) {
            failures.push(`plan: ${error?.message || error}`)
          }
        }
      }

      return failures.length > 0
        ? { ok: false, applied, failures }
        : { ok: true, applied }
    },
  }

  const uploads = createUploadManager({
    log,
    getAttachments: () => (typeof ctx.get === 'function' ? safely(() => ctx.get('attachments')) : undefined),
  })

  const hitl = createHitl({ broadcast: broadcastHitl, log, takeover: config.hitl?.takeover })
  let hitlListening = false

  /** Fan a HITL frame out to every page currently streaming this session. */
  function broadcastHitl(sessionId, frame) {
    // Notify out of band even when no page is attached: the phone may be in a
    // pocket, which is exactly when a notification matters.
    if (frame?.type === 'hitl/request') {
      notifier?.notifyRequest(frame)?.catch?.(() => {})
    }
    const clients = streamClients.get(sessionId)
    if (!clients || clients.size === 0) return
    const payload = `data: ${JSON.stringify(frame)}\n\n`
    for (const res of clients) {
      try { res.write(payload) } catch { /* the reader went away */ }
    }
  }

  if (typeof ctx.effect === 'function' && config.hitl?.enabled) {
    ctx.effect(() => {
      const offAudit = ctx.on('session/event', (session, event) => {
        const type = event?.type
        if (type === 'approval/asked') {
          hitl.noteAsked(session?.id, event?.data?.id, event?.data?.callId)
        } else if (type === 'approval/decided') {
          // The decision is already final here; any entry we still hold for that
          // call could never be answered and would show up as a ghost card.
          hitl.settleDecided(session?.id, event?.data?.id)
        }
      })
      // `prepend` is required: the Remote event bridge (mounted by the web app
      // before this plugin) claims `approval/request` by returning a promise
      // that waits for the desktop client, and a waterfall stops at the first
      // listener that answers. Running first lets us offer the request to the
      // page and then hand it on with `next()`, so both sides can answer.
      const offApproval = ctx.on('approval/request', (request, next) => hitl.handleApproval(request, next), { prepend: true })
      const offQuestions = ctx.on('user-questions/request', (request, next) => hitl.handleQuestion(request, next), { prepend: true })
      hitlListening = true
      return () => {
        hitlListening = false
        try { offAudit?.() } catch { /* already disposed */ }
        try { offApproval?.() } catch { /* already disposed */ }
        try { offQuestions?.() } catch { /* already disposed */ }
        hitl.close()
      }
    })
  }

  fabric = createFabric({
    log,
    config,
    stateFile: peersFile,
    store: createCredentialStore(ctx, peersFile, log),
    uploads,
    identity: () => deviceIdentity,
    limits: { rateMax: config.rateMax, rateWindowMs: config.rateWindowMs },
    self: () => ({
      deviceId: state?.deviceId ?? '',
      deviceName: config.deviceName,
      userId: identity.userId,
      port: info.port,
      proto: info.proto,
      relayUrl: relayLink?.url() ?? '',
      pairCode: hostedPairCode || joinPairCode || config.pairCode || '',
      publicKey: deviceIdentity?.ed25519?.publicKeyPem ?? '',
      fingerprint: deviceIdentity?.fingerprint ?? '',
      agreementKey: deviceIdentity?.x25519?.publicKeyPem ?? '',
    }),
    sessions,
  })

  const tunnelProvisioner = createTunnelProvisioner({
    config: config.service.tunnel,
    stateDir: dshHome(),
    log,
  })
  const serviceManager = createServiceManager({
    config: config.service,
    localPort: () => info.port,
    log,
    provisioner: tunnelProvisioner,
    onAddressChange: () => {
      log.info('[remote-control] service: interface change detected; relay re-registration is Phase 2')
    },
  })
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => { try { serviceManager.stop() } catch { /* ignore */ } })
  }

  const ready = loadState(stateFile, config, log)
    .then(async (loaded) => {
      state = loaded
      notifier = createNotifier({ config: config.notify, secret: state.secret, log })
      deviceIdentity = await loadOrCreateIdentity(
        identityFile,
        log,
        createCredentialStore(ctx, identityFile, log, 'remote-control/identity'),
      )
      await refreshIdentity()
      await start()
      try {
        await fabric.start()
      } catch (error) {
        log.warn(`[remote-control] peer discovery disabled: ${error?.message || error}`)
      }
      if (config.relayUrl && config.relayKey) {
        try {
          await startRelay(config.relayUrl, config.relayKey)
        } catch (error) {
          log.warn(`[remote-control] relay disabled: ${error?.message || error}`)
        }
      } else {
        const persisted = await loadRelayConfig()
        if (persisted?.hosted && persisted.key) {
          try {
            await startHostedRelay(persisted.key, persisted.pairCode)
          } catch (error) {
            log.warn(`[remote-control] hosted relay disabled: ${error?.message || error}`)
          }
        } else if (persisted) {
          joinPairCode = typeof persisted.pairCode === 'string' ? persisted.pairCode : ''
          try {
            await startRelay(persisted.url, persisted.key)
          } catch (error) {
            log.warn(`[remote-control] relay disabled: ${error?.message || error}`)
          }
        }
      }
      if (state.setup?.completed && state.setup.provider) {
        // The first-run wizard's choice wins over config so a restart keeps the
        // service the user picked (and the dependency it installed).
        serviceManager.setMode({ provider: state.setup.provider, relayUrl: relayLink?.url() ?? '' })
        try {
          await serviceManager.start()
        } catch (error) {
          log.warn(`[remote-control] service start failed: ${error?.message || error}`)
        }
      } else if (config.service.enabled) {
        try {
          await serviceManager.start()
        } catch (error) {
          log.warn(`[remote-control] service disabled: ${error?.message || error}`)
        }
      }
      const refresh = setInterval(() => { refreshIdentity().catch(() => {}) }, 60000)
      refresh.unref?.()
      ctx.effect(() => () => clearInterval(refresh))
    })
    .catch((error) => {
      log.error(`[remote-control] disabled: ${error?.message || error}`)
    })

  async function refreshIdentity() {
    const account = typeof ctx.get === 'function' ? safely(() => ctx.get('deepseekAccount')) : undefined
    if (!account || typeof account.getDeviceIdentity !== 'function') return
    try {
      const value = await account.getDeviceIdentity()
      identity.userId = value?.userId ?? null
    } catch { /* signed out or unavailable */ }
  }

  const relayFile = path.join(dshHome(), 'remote-control-relay.json')

  async function loadRelayConfig() {
    try {
      const raw = JSON.parse(await readFile(relayFile, 'utf8'))
      if (raw && typeof raw.url === 'string' && typeof raw.key === 'string') {
        // `hosted` decides whether boot remounts the relay before connecting.
        // Dropping it made every restart fall into the join branch, which then
        // pointed at an unmounted /v1/* and left the relay dead.
        return { hosted: raw.hosted === true, url: raw.url, key: raw.key }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') log.warn(`[remote-control] could not read ${relayFile}: ${error?.message || error}`)
    }
    return null
  }

  async function saveRelayConfig(value) {
    try {
      await writeFile(relayFile, JSON.stringify(value, null, 2), { mode: 0o600 })
    } catch (error) {
      log.warn(`[remote-control] could not persist ${relayFile}: ${error?.message || error}`)
    }
  }

  async function clearRelayConfig() {
    try { await rm(relayFile, { force: true }) } catch { /* ignore */ }
  }

  async function startRelay(url, key) {
    const link = createRelayLink({
      url,
      key,
      deviceId: state.deviceId,
      deviceName: config.deviceName,
      userId: identity.userId,
      localPort: info.port,
      log,
    })
    // Connect first: a failed join must not tear down a working relay link.
    await link.start()
    stopRelay()
    relayLink = link
    fabric.setRelay(link)
    log.info(`[remote-control] relay connected: ${url}`)
  }

  function stopRelay() {
    if (!relayLink) return
    try { relayLink.stop() } catch { /* ignore */ }
    relayLink = undefined
    try { fabric?.setRelay(undefined) } catch { /* ignore */ }
  }

  /** Serve the relay from this Host and point our own link at it. */
  async function startHostedRelay(key, code) {
    stopHostedRelay()
    relayCore = createRelay({ log })
    hostedKey = key
    hostedPairCode = code || generatePairCode()
    try {
      await startRelay(`http://127.0.0.1:${info.port}`, key)
    } catch (error) {
      stopHostedRelay()
      throw error
    }
  }

  function stopHostedRelay() {
    if (relayCore) {
      try { relayCore.close() } catch { /* ignore */ }
      relayCore = undefined
    }
    hostedKey = ''
    hostedPairCode = ''
  }

  function shareUrls() {
    if (config.publicUrl) return [config.publicUrl.replace(/\/+$/, '')]
    return accessUrls(config, info.port, info.proto)
  }

  ctx.effect(() => () => {
    for (const controller of streams) {
      try { controller.abort() } catch { /* ignore */ }
    }
    streams.clear()
    try { uploads?.close() } catch { /* ignore */ }
    try { relayLink?.stop() } catch { /* ignore */ }
    try { relayCore?.close() } catch { /* ignore */ }
    try { fabric?.stop() } catch { /* ignore */ }
    if (server) {
      try { server.close() } catch { /* ignore */ }
      server = undefined
    }
  })

  // Discoverability: the local GUI can show the pairing code and reachable URLs.
  // The handler refuses any non-loopback Host, so it never leaks over a LAN bind.
  const webServer = typeof ctx.get === 'function' ? safely(() => ctx.get('webServer')) : undefined
  if (webServer && typeof webServer.register === 'function') {
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/remote-control',
      handler: (req, res) => serveInfo(req, res, published),
    }))
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/remote-control/api',
      handler: (req, res) => {
        handleConsole(req, res).catch((error) => {
          log.warn(`[remote-control] console call failed: ${error?.message || error}`)
          try { json(res, 500, { error: 'internal', message: String(error?.message || error) }) } catch { /* ignore */ }
        })
      },
    }))
  }

  async function handleConsole(req, res) {
    if (!consoleAllowed(req)) return json(res, 403, { error: 'forbidden' })
    if (!fabric) return json(res, 503, { error: 'starting' })
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const action = url.pathname.slice('/remote-control/api'.length)

    if (action === '/state' && req.method === 'GET') {
      const snapshot = fabric.snapshot()
      const urls = relayCore ? shareUrls() : []
      snapshot.relay = {
        url: relayLink?.url() ?? '',
        connected: relayLink?.connected() ?? false,
        peers: relayLink?.peers().length ?? 0,
        hosted: Boolean(relayCore),
        urls,
        invite: relayCore && hostedKey && urls[0] ? `${urls[0]} ${hostedKey}#${hostedPairCode}` : '',
        pairCode: hostedPairCode || joinPairCode || '',
      }
      snapshot.service = serviceManager.snapshot()
      snapshot.setup = state?.setup ?? { completed: false }
      // The Devices panel is the only place the pairing code is shown; this
      // route is gated by consoleAllowed (same-origin GUI or loopback), so the
      // code never reaches a phone that has not paired yet.
      snapshot.pairing = { code: published.code, urls: published.urls.slice() }
      return json(res, 200, snapshot)
    }
    if (action === '/relay/host' && req.method === 'POST') {
      await ready
      const body = await readJson(req)
      if (body?.enabled === false) {
        stopRelay()
        stopHostedRelay()
        await clearRelayConfig()
        return json(res, 200, { ok: true })
      }
      let key = typeof body?.key === 'string' && body.key.length >= 16 ? body.key : ''
      const persisted = await loadRelayConfig()
      if (!key) {
        key = persisted?.hosted && persisted.key ? persisted.key : randomBytes(16).toString('hex')
      }
      const code = persisted?.pairCode && /^\d{4,8}$/.test(persisted.pairCode) ? persisted.pairCode : ''
      try {
        await startHostedRelay(key, code)
      } catch (error) {
        return json(res, 502, { error: 'relay-failed', message: String(error?.message || error) })
      }
      const urls = shareUrls()
      let reachability = null
      try {
        reachability = await ensureReachable({ port: info.port, allowInsecure: config.allowInsecureRelay })
      } catch { /* diagnostics only */ }
      const inviteBase = reachability?.ok && reachability.url ? reachability.url : (urls[0] ?? '')
      const allUrls = reachability?.ok && reachability.url ? [reachability.url, ...urls] : urls
      await saveRelayConfig({ hosted: true, url: inviteBase, key, pairCode: hostedPairCode })
      log.info(`[remote-control] hosting a relay at ${inviteBase || '(no address)'}`)
      return json(res, 200, {
        ok: true,
        urls: allUrls,
        pairCode: hostedPairCode,
        reachability,
        invite: `${inviteBase} ${key}#${hostedPairCode}`,
      })
    }
    if (action === '/relay' && req.method === 'POST') {
      await ready
      const body = await readJson(req)
      let url = String(body?.url || '').trim()
      let key = String(body?.key || '')
      let code = String(body?.pairCode || '')
      // Invite form "<url> <key>#<code>": accept it whole or already split.
      const urlHash = url.indexOf('#')
      if (urlHash >= 0) { code = code || url.slice(urlHash + 1); url = url.slice(0, urlHash) }
      const keyHash = key.indexOf('#')
      if (keyHash >= 0) { code = code || key.slice(keyHash + 1); key = key.slice(0, keyHash) }
      const verdict = checkRelayUrl(url, { allowInsecure: config.allowInsecureRelay })
      if (!verdict.ok) return json(res, 400, { error: verdict.error, message: verdict.message })
      if (key.length < 16) {
        return json(res, 400, { error: 'bad-key', message: 'Workspace key must be at least 16 characters.' })
      }
      joinPairCode = /^\d{4,8}$/.test(code) ? code : ''
      try {
        await startRelay(url, key)
      } catch (error) {
        return json(res, 502, { error: 'relay-unreachable', message: String(error?.message || error) })
      }
      stopHostedRelay()
      await saveRelayConfig({ hosted: false, url, key, pairCode: joinPairCode })
      return json(res, 200, { ok: true, pairCode: joinPairCode })
    }
    if (action === '/relay/reachability' && req.method === 'GET') {
      await ready
      if (!relayCore) {
        return json(res, 409, { error: 'not-hosting', message: 'Create a relay on this device first.' })
      }
      const result = await ensureReachable({ port: info.port, allowInsecure: config.allowInsecureRelay })
      return json(res, 200, result)
    }
    if (action === '/relay/clear' && req.method === 'POST') {
      stopRelay()
      stopHostedRelay()
      await clearRelayConfig()
      return json(res, 200, { ok: true })
    }
    if (action === '/qr' && req.method === 'GET') {
      const text = String(url.searchParams.get('text') || '')
      if (!text || text.length > 106) return json(res, 400, { error: 'bad-text' })
      res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store' })
      return res.end(qrSvg(text))
    }
    if (action.startsWith('/upload/') && req.method === 'POST') {
      const name = action.slice('/upload/'.length)
      const handler = uploads?.[name]
      if (typeof handler !== 'function') return json(res, 404, { error: 'not-found' })
      let body
      try {
        body = await readJson(req, 8 * 1024 * 1024)
      } catch {
        return json(res, 400, { error: 'bad-body' })
      }
      const result = await handler(body)
      return json(res, result.status ?? 200, result)
    }
    if (action === '/service/tunnel' && req.method === 'GET') {
      return json(res, 200, tunnelProvisioner.plan())
    }
    if (action === '/service/tunnel/install' && req.method === 'POST') {
      await ready
      const body = await readJson(req)
      const result = await tunnelProvisioner.install({ consent: body?.consent === true })
      if (result.ok && config.service.enabled) {
        try { await serviceManager.start() } catch { /* surfaced in the snapshot */ }
      }
      return json(res, result.ok ? 200 : 400, { ...result, service: serviceManager.snapshot() })
    }
    if (action === '/setup' && req.method === 'GET') {
      return json(res, 200, {
        setup: state?.setup ?? { completed: false },
        service: serviceManager.snapshot(),
        relay: relayLink ? { connected: relayLink.connected(), url: relayLink.url(), hosted: Boolean(relayCore) } : null,
      })
    }
    if (action === '/setup/complete' && req.method === 'POST') {
      await ready
      let body = {}
      try { body = await readJson(req) } catch { body = {} }
      state.setup = {
        completed: true,
        mode: typeof body?.mode === 'string' ? body.mode : '',
        provider: typeof body?.provider === 'string' ? body.provider : '',
        at: Date.now(),
      }
      await persistState(stateFile, state, log)
      log.info(`[remote-control] first-run setup completed: ${state.setup.mode}`)
      return json(res, 200, { ok: true, setup: state.setup })
    }
    if (action === '/service' && req.method === 'GET') {
      // The Devices panel is the only place the pairing code is shown: it is
      // gated by consoleAllowed (same-origin GUI or loopback), so it never
      // reaches a phone that has not paired yet.
      return json(res, 200, {
        ...serviceManager.snapshot(),
        pairing: { code: published.code, urls: published.urls.slice() },
      })
    }
    if (action === '/service/start' && req.method === 'POST') {
      await ready
      let body = {}
      try { body = await readJson(req) } catch { body = {} }
      if (body && typeof body.provider === 'string') {
        serviceManager.setMode({
          provider: body.provider,
          relayUrl: typeof body.relayUrl === 'string' ? body.relayUrl : (relayLink?.url() ?? ''),
          publicUrl: typeof body.publicUrl === 'string' ? body.publicUrl : config.publicUrl,
        })
      }
      await serviceManager.start()
      return json(res, 200, serviceManager.snapshot())
    }
    if (action === '/service/stop' && req.method === 'POST') {
      serviceManager.stop()
      return json(res, 200, serviceManager.snapshot())
    }
    if (action === '/revoke' && req.method === 'POST') {
      const body = await readJson(req)
      return json(res, 200, fabric.revoke(String(body?.deviceId || '')))
    }
    if (action === '/scopes' && req.method === 'POST') {
      const body = await readJson(req)
      return json(res, 200, fabric.setScopes(String(body?.deviceId || ''), body?.scopes))
    }
    if (action === '/approve' && req.method === 'POST') {
      const body = await readJson(req)
      return json(res, 200, await fabric.approveRequest(String(body?.requestId || '')))
    }
    if (action === '/deny' && req.method === 'POST') {
      const body = await readJson(req)
      return json(res, 200, fabric.denyRequest(String(body?.requestId || '')))
    }
    if (action === '/connect' && req.method === 'POST') {
      const body = await readJson(req)
      return json(res, 200, await fabric.connect(String(body?.deviceId || '')))
    }

    const match = action.match(/^\/peer\/([^/]+)\/(sessions|stream|prompt|cancel|session-config)$/)
    if (match) {
      const deviceId = decodeURIComponent(match[1])
      const operation = match[2]
      if (operation === 'session-config' && req.method === 'GET') {
        const sessionId = String(url.searchParams.get('sessionId') || '')
        const reply = await fabric.callPeer(deviceId, 'GET', `/peer/session/config?sessionId=${encodeURIComponent(sessionId)}`, undefined, { race: true })
        return json(res, reply.status ?? (reply.ok ? 200 : 502), reply.json ?? { error: reply.error })
      }
      if (operation === 'session-config' && req.method === 'POST') {
        const body = await readJson(req)
        const reply = await fabric.callPeer(deviceId, 'POST', '/peer/session/config', body)
        return json(res, reply.status ?? (reply.ok ? 200 : 502), reply.json ?? { error: reply.error })
      }
      if (operation === 'sessions' && req.method === 'GET') {
        const reply = await fabric.callPeer(deviceId, 'GET', '/peer/sessions', undefined, { race: true })
        return json(res, reply.status ?? (reply.ok ? 200 : 502), reply.json ?? { error: reply.error })
      }
      if (operation === 'stream' && req.method === 'GET') {
        return fabric.proxyStream(deviceId, String(url.searchParams.get('sessionId') || ''), res)
      }
      if (operation === 'prompt' && req.method === 'POST') {
        const body = await readJson(req)
        const reply = await fabric.callPeer(deviceId, 'POST', '/peer/prompt', {
          sessionId: body?.sessionId,
          text: body?.text,
        })
        return json(res, reply.status ?? (reply.ok ? 200 : 502), reply.json ?? { error: reply.error })
      }
      if (operation === 'cancel' && req.method === 'POST') {
        const body = await readJson(req)
        const reply = await fabric.callPeer(deviceId, 'POST', '/peer/cancel', { sessionId: body?.sessionId })
        return json(res, reply.status ?? (reply.ok ? 200 : 502), reply.json ?? { error: reply.error })
      }
    }
    return json(res, 404, { error: 'not-found' })
  }

  async function start() {
    const options = {}
    let factory = createHttpServer
    let scheme = 'http'
    if (config.tls) {
      const [cert, key] = await Promise.all([
        readFile(path.resolve(config.tls.certFile)),
        readFile(path.resolve(config.tls.keyFile)),
      ])
      options.cert = cert
      options.key = key
      factory = createHttpsServer
      scheme = 'https'
    }

    server = factory(options, (req, res) => {
      handle(req, res).catch((error) => {
        log.error(`[remote-control] request failed: ${error?.stack || error}`)
        try { json(res, 500, { error: 'internal', message: String(error?.message || error) }) } catch { /* ignore */ }
      })
    })
    server.on('clientError', (_error, socket) => {
      try { socket.destroy() } catch { /* ignore */ }
    })

    await new Promise((resolve, reject) => {
      const onError = (error) => reject(error)
      server.once('error', onError)
      server.listen(config.port, config.host, () => {
        server.off('error', onError)
        resolve()
      })
    })

    server.on('error', (error) => log.error(`[remote-control] listener error: ${error?.message || error}`))

    const port = server.address()?.port ?? config.port
    info.port = port
    info.proto = scheme
    const urls = accessUrls(config, port, scheme)
    published.urls = urls
    published.code = state.code
    log.info(`[remote-control] pairing code: ${state.code}`)
    log.info(`[remote-control] open one of: ${urls.join('  ')}`)
    log.info(`[remote-control] state file: ${stateFile} (delete it to rotate the code)`)
  }

  async function handle(req, res) {
    const host = String(req.headers.host || '')
    if (!hostAllowed(host, config)) {
      return json(res, 403, { error: 'host-not-allowed', message: 'This Host header is not trusted by the remote-control listener.' })
    }

    const url = new URL(req.url || '/', `http://${host || 'localhost'}`)
    const pathname = url.pathname

    if (pathname === '/peer' || pathname.startsWith('/peer/')) {
      return fabric.handlePeer(req, res, url)
    }

    if (relayCore && pathname.startsWith('/v1/')) {
      return relayCore.handle(req, res)
    }

    if (req.method === 'GET' && STATIC_FILES[pathname]) {
      const [file, type] = STATIC_FILES[pathname]
      return serveStatic(res, file, type)
    }

    if (pathname === '/api/me') {
      return json(res, 200, {
        authenticated: isAuthenticated(req, state.secret),
        name: 'DSH Remote Control',
        version: '0.1.0',
      })
    }

    if (pathname === '/api/pair' && req.method === 'POST') {
      return pair(req, res)
    }

    // Notification action links are opened from the phone's notification shade,
    // which carries no pairing cookie: the per-request HMAC is the credential.
    if (pathname === '/api/notify/action' && req.method === 'GET') {
      const requestId = String(url.searchParams.get('r') || '')
      const decision = url.searchParams.get('d') === 'deny' ? 'deny' : 'allow'
      const signature = String(url.searchParams.get('t') || '')
      if (!requestId || !verifyAction(state.secret, requestId, decision, signature)) {
        return htmlPage(res, 403, 'This notification link is not valid.')
      }
      const accepted = hitl.answer(requestId, { decision })
      if (!accepted) {
        return htmlPage(res, 409, 'That request was already answered or withdrawn.')
      }
      return htmlPage(res, 200, decision === 'allow'
        ? 'Allowed once. You can close this page.'
        : 'Rejected. You can close this page.')
    }

    if (pathname.startsWith('/api/')) {
      if (!isAuthenticated(req, state.secret)) {
        return json(res, 401, { error: 'unauthorized' })
      }
      if (req.method === 'POST' && !sameOrigin(req, config)) {
        return json(res, 403, { error: 'origin-not-allowed' })
      }
    }

    if (pathname === '/api/logout' && req.method === 'POST') {
      res.setHeader('set-cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`)
      return json(res, 200, { ok: true })
    }

    if (pathname === '/api/sessions' && req.method === 'GET') {
      if (!ctx.sessionController) return json(res, 503, { error: 'session-controller-unavailable' })
      return listSessions(res)
    }

    if (pathname === '/api/state' && req.method === 'GET') {
      if (!ctx.sessionController) return json(res, 503, { error: 'session-controller-unavailable' })
      const sessionId = String(url.searchParams.get('sessionId') || '')
      if (!sessionId) return json(res, 400, { error: 'missing-session' })
      try {
        const state = await ctx.sessionController.state({ sessionId }, AbortSignal.timeout(8000))
        const queue = (state?.queue ?? [])
          .map((item) => ({
            id: String(item?.id ?? ''),
            placement: String(item?.placement ?? 'queued'),
            text: contentText(item?.content),
          }))
          .filter((item) => item.id !== '')
        return json(res, 200, {
          active: Boolean(state?.active),
          running: Boolean(state?.running),
          queue,
        })
      } catch (error) {
        return json(res, 500, { error: 'state-failed', message: error?.message || String(error) })
      }
    }

    if (pathname === '/api/queue' && req.method === 'POST') {
      if (!ctx.sessionController) return json(res, 503, { error: 'session-controller-unavailable' })
      const body = await readJson(req)
      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
      const itemId = typeof body?.itemId === 'string' ? body.itemId : ''
      const kind = body?.action?.kind
      if (!sessionId || !itemId) return json(res, 400, { error: 'missing-queue-item' })
      const action = kind === 'steer' ? { kind: 'steer' } : kind === 'remove' ? { kind: 'remove' } : null
      if (!action) return json(res, 400, { error: 'bad-action' })
      try {
        const value = await ctx.sessionController.updateQueue({ sessionId, itemId, action })
        return json(res, 200, value ?? { accepted: true })
      } catch (error) {
        return json(res, 409, { error: 'queue-update-failed', message: error?.message || String(error) })
      }
    }

    if (pathname === '/api/file' && req.method === 'GET') {
      const sessionId = String(url.searchParams.get('sessionId') || '')
      const requested = String(url.searchParams.get('path') || '')
      if (!requested) return json(res, 400, { error: 'missing-path' })

      let base = ''
      try {
        const items = await sessions.list()
        base = items.find((item) => item.id === sessionId)?.cwd || ''
      } catch { /* a missing session just loses the relative root */ }

      const target = path.isAbsolute(requested) ? requested : path.resolve(base || process.cwd(), requested)
      let real
      try {
        real = await realpath(target)
      } catch {
        return json(res, 404, { error: 'not-found' })
      }

      // Reads stay inside the Session workspace or the DSH home directory; the
      // pairing cookie is authentication, not authorisation to read the disk.
      const roots = [base, typeof dshHome === 'function' ? dshHome() : '']
        .filter((root) => typeof root === 'string' && root !== '')
        .map((root) => path.resolve(root))
      const allowed = roots.some((root) => real === root || real.startsWith(root + path.sep))
      if (!allowed) return json(res, 403, { error: 'outside-workspace', path: real })

      let meta
      try {
        meta = await statOf(real)
      } catch {
        return json(res, 404, { error: 'not-found' })
      }
      if (!meta.isFile()) return json(res, 400, { error: 'not-a-file' })
      if (meta.size > 5 * 1024 * 1024) return json(res, 413, { error: 'too-large', bytes: meta.size })

      const image = IMAGE_KINDS[path.extname(real).toLowerCase()]
      if (image || url.searchParams.get('raw') === '1') {
        const data = await readFile(real)
        res.writeHead(200, {
          'content-type': image || 'application/octet-stream',
          'content-length': data.length,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        })
        return res.end(data)
      }

      const data = await readFile(real)
      const text = data.toString('utf8')
      return json(res, 200, {
        kind: 'text',
        path: real,
        name: path.basename(real),
        bytes: data.length,
        truncated: text.length > FILE_TEXT_LIMIT,
        text: text.slice(0, FILE_TEXT_LIMIT),
      })
    }

    if (pathname === '/api/history' && req.method === 'GET') {
      if (!ctx.sessionController) return json(res, 503, { error: 'session-controller-unavailable' })
      const sessionId = String(url.searchParams.get('sessionId') || '')
      if (!sessionId) return json(res, 400, { error: 'missing-session' })
      const before = Number(url.searchParams.get('before'))
      const maxMessages = Math.min(200, Math.max(10, Number(url.searchParams.get('max')) || 60))
      try {
        const page = await ctx.sessionController.events({
          address: { kind: 'session', sessionId },
          ...(Number.isFinite(before) && before > 0 ? { beforeSeq: before } : {}),
          maxMessages,
        }, AbortSignal.timeout(20000))
        return json(res, 200, {
          records: page?.records ?? [],
          cursor: page?.cursor ?? null,
          hasMore: Boolean(page?.hasMore),
        })
      } catch (error) {
        return json(res, 500, { error: 'history-failed', message: error?.message || String(error) })
      }
    }

    if (pathname === '/api/stream' && req.method === 'GET') {
      if (!ctx.sessionController) return json(res, 503, { error: 'session-controller-unavailable' })
      return streamSession(req, res, url)
    }

    if (pathname === '/api/prompt' && req.method === 'POST') {
      if (!ctx.sessionController) return json(res, 503, { error: 'session-controller-unavailable' })
      return promptSession(req, res)
    }

    if (pathname === '/api/cancel' && req.method === 'POST') {
      if (!ctx.sessionController) return json(res, 503, { error: 'session-controller-unavailable' })
      return cancelSession(req, res)
    }

    if (pathname === '/api/new-session' && req.method === 'POST') {
      if (!ctx.sessionController) return json(res, 503, { error: 'session-controller-unavailable' })
      return newSession(req, res)
    }

    if (pathname === '/api/attachment' && req.method === 'GET') {
      const attachments = typeof ctx.get === 'function' ? safely(() => ctx.get('attachments')) : undefined
      if (!attachments) return json(res, 503, { error: 'attachments-unavailable' })

      // The reader passes back the exact durable reference from the transcript:
      // the store verifies id, name, media type, size and dimensions against it,
      // so reconstructing a partial one here would fail verification.
      const raw = String(url.searchParams.get('ref') || '')
      if (!raw) return json(res, 400, { error: 'missing-ref' })
      let ref
      try {
        ref = JSON.parse(raw)
      } catch {
        return json(res, 400, { error: 'bad-ref' })
      }
      if (!ref || typeof ref !== 'object' || typeof ref.attachmentId !== 'string') {
        return json(res, 400, { error: 'bad-ref' })
      }

      const isImage = typeof ref.mediaType === 'string' && ref.mediaType.startsWith('image/')
      try {
        if (isImage) {
          const stored = await attachments.readImage(ref)
          const bytes = Buffer.from(stored.data)
          res.writeHead(200, {
            'content-type': stored.mediaType || ref.mediaType,
            'content-length': bytes.length,
            'cache-control': 'private, max-age=3600',
            'x-content-type-options': 'nosniff',
          })
          return res.end(bytes)
        }

        const chunks = []
        let total = 0
        for await (const chunk of attachments.readFileStream(ref)) {
          total += chunk.length
          if (total > 64 * 1024 * 1024) return json(res, 413, { error: 'file-too-large' })
          chunks.push(Buffer.from(chunk))
        }
        const bytes = Buffer.concat(chunks)
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': bytes.length,
          'content-disposition': `attachment; filename="${String(ref.name || 'file').replace(/["\\]/g, '_')}"`,
          'x-content-type-options': 'nosniff',
        })
        return res.end(bytes)
      } catch (error) {
        return json(res, 404, { error: 'attachment-unreadable', message: error?.message || String(error) })
      }
    }

    if (pathname === '/api/hitl' && req.method === 'GET') {
      return json(res, 200, {
        enabled: Boolean(config.hitl?.enabled),
        listening: hitlListening,
        ...hitl.stats(),
        items: hitl.pendingAll(),
        notify: notifier?.stats?.() ?? { kind: 'none', enabled: false },
      })
    }

    if (pathname === '/api/config' && req.method === 'GET') {
      if (!ctx.sessionController) return json(res, 503, { error: 'session-controller-unavailable' })
      const sessionId = String(url.searchParams.get('sessionId') || '')
      if (!sessionId) return json(res, 400, { error: 'missing-session' })
      return json(res, 200, await sessions.config(sessionId))
    }

    if (pathname === '/api/config' && req.method === 'POST') {
      if (!ctx.sessionController) return json(res, 503, { error: 'session-controller-unavailable' })
      const body = await readJson(req)
      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
      if (!sessionId) return json(res, 400, { error: 'missing-session' })
      const patch = {}
      if (body?.model && typeof body.model === 'object') patch.model = body.model
      if (typeof body?.permission === 'string') patch.permission = body.permission
      if (typeof body?.plan === 'boolean') patch.plan = body.plan
      const result = await sessions.applyConfig(sessionId, patch)
      return json(res, result?.ok === false ? 409 : 200, result)
    }

    if (pathname.startsWith('/api/upload/') && req.method === 'POST') {
      const action = pathname.slice('/api/upload/'.length)
      if (!UPLOAD_ACTIONS.has(action) || !uploads) return json(res, 404, { error: 'unknown-upload-action' })
      let body
      try {
        body = await readJson(req, UPLOAD_BODY_BYTES)
      } catch (error) {
        return json(res, 413, { error: 'body-too-large', message: error?.message || String(error) })
      }
      const result = await uploads[action](body)
      const status = Number(result?.status) || 200
      const payload = { ...result }
      delete payload.status
      return json(res, status, payload)
    }

    if (pathname === '/api/approval' && req.method === 'POST') {
      const body = await readJson(req)
      const requestId = typeof body?.requestId === 'string' ? body.requestId : ''
      if (!requestId) return json(res, 400, { error: 'missing-request' })
      const ok = hitl.answer(requestId, { decision: body?.decision })
      return ok
        ? json(res, 200, { ok: true })
        : json(res, 409, { error: 'unknown-request', message: 'That approval was already answered or withdrawn.' })
    }

    if (pathname === '/api/answer' && req.method === 'POST') {
      const body = await readJson(req)
      const requestId = typeof body?.requestId === 'string' ? body.requestId : ''
      if (!requestId) return json(res, 400, { error: 'missing-request' })
      const ok = hitl.answer(requestId, { answers: body?.answers })
      return ok
        ? json(res, 200, { ok: true })
        : json(res, 409, { error: 'unknown-request', message: 'That question was already answered or withdrawn.' })
    }

    return json(res, 404, { error: 'not-found' })
  }

  async function pair(req, res) {
    if (!sameOrigin(req, config)) return json(res, 403, { error: 'origin-not-allowed' })
    const body = await readJson(req)
    const code = typeof body?.code === 'string' ? body.code.trim() : ''
    const ip = clientIp(req)
    if (tooManyAttempts(ip)) {
      return json(res, 429, { error: 'rate-limited', message: 'Too many attempts. Wait a few minutes and try again.' })
    }
    if (!constantTimeEquals(code, state.code)) {
      recordFailure(ip)
      log.warn(`[remote-control] rejected pairing attempt from ${ip}`)
      return json(res, 401, { error: 'bad-code', message: 'That pairing code is not correct.' })
    }
    recordSuccess(ip)
    const token = issueToken(state.secret, config.cookieDays)
    const attributes = [
      `${COOKIE_NAME}=${token}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${Math.round(Math.max(1, config.cookieDays) * 86400)}`,
    ]
    if (config.tls) attributes.push('Secure')
    res.setHeader('set-cookie', attributes.join('; '))
    log.info(`[remote-control] paired a browser from ${ip}`)
    return json(res, 200, { ok: true })
  }

  async function listSessions(res) {
    const items = await sessions.list()
    return json(res, 200, { items })
  }

  async function streamSession(req, res, url) {
    const sessionId = String(url.searchParams.get('sessionId') || '')
    if (!sessionId) return json(res, 400, { error: 'missing-session' })

    const controller = new AbortController()
    streams.add(controller)
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    res.write(': connected\n\n')

    // Track this reader so approval and question requests can reach it, and
    // replay anything already waiting so a late page mirrors the local state.
    const clients = streamClients.get(sessionId) ?? new Set()
    streamClients.set(sessionId, clients)
    clients.add(res)
    hitl.watch(sessionId)

    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n') } catch { /* ignore */ }
    }, 15000)
    heartbeat.unref?.()

    let closed = false
    const cleanup = () => {
      if (closed) return
      closed = true
      clearInterval(heartbeat)
      streams.delete(controller)
      clients.delete(res)
      if (clients.size === 0) streamClients.delete(sessionId)
      hitl.unwatch(sessionId)
      try { controller.abort() } catch { /* ignore */ }
      try { res.end() } catch { /* ignore */ }
    }
    req.on('close', cleanup)
    req.on('aborted', cleanup)

    try {
      const frames = ctx.sessionController.follow(
        {
          address: { kind: 'session', sessionId },
          assistantStream: true,
          maxMessages: HISTORY_MESSAGES,
        },
        controller.signal,
      )
      let replayed = false
      for await (const frame of frames) {
        if (res.writableEnded || res.destroyed) break
        res.write(`data: ${JSON.stringify(frame)}\n\n`)
        if (replayed) continue
        replayed = true
        // Replay only after the opening snapshot: the page renders frames in
        // arrival order, so sending pending cards first would park them above
        // the whole transcript. Always send it, even when empty — the page
        // treats it as the authoritative set, which is what clears a card that
        // was answered while this tab was suspended.
        const pendingHitl = hitl.pendingFor(sessionId)
        try { res.write(`data: ${JSON.stringify({ type: 'hitl/pending', items: pendingHitl })}\n\n`) } catch { /* ignore */ }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const payload = { type: 'remote-error', code: error?.code ?? 'error', message: error?.message ?? String(error) }
        try { res.write(`data: ${JSON.stringify(payload)}\n\n`) } catch { /* ignore */ }
        log.warn(`[remote-control] follow failed for ${sessionId}: ${error?.message || error}`)
      }
    } finally {
      cleanup()
    }
  }

  async function promptSession(req, res) {
    const body = await readJson(req)
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
    const text = typeof body?.text === 'string' ? body.text : ''
    const mode = body?.mode === 'steer' ? 'steer' : 'queue'
    const attachments = Array.isArray(body?.attachments) ? body.attachments : []
    if (!sessionId) return json(res, 400, { error: 'missing-session' })
    if (!text.trim() && attachments.length === 0) {
      return json(res, 400, { error: 'empty-prompt', message: 'Write a message or attach a file first.' })
    }

    try {
      const accepted = await sessions.prompt(sessionId, { text, mode, attachments })
      return json(res, 200, accepted ?? { accepted: true })
    } catch (error) {
      return json(res, 400, { error: 'prompt-rejected', message: error?.message || String(error) })
    }
  }

  async function cancelSession(req, res) {
    const body = await readJson(req)
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
    if (!sessionId) return json(res, 400, { error: 'missing-session' })
    const value = ctx.sessionController.cancel({ sessionId })
    return json(res, 200, value ?? { accepted: true })
  }

  async function newSession(req, res) {
    const body = await readJson(req)
    const request = {}
    if (typeof body?.cwd === 'string' && body.cwd.trim()) request.cwd = body.cwd.trim()
    else if (config.defaultCwd) request.cwd = config.defaultCwd
    const value = await ctx.sessionController.create(request)
    return json(res, 200, value)
  }

  async function serveStatic(res, file, type) {
    try {
      const data = await readFile(path.join(WEB_DIR, file))
      res.writeHead(200, {
        'content-type': type,
        'cache-control': 'no-store',
        'content-length': data.length,
        'x-content-type-options': 'nosniff',
      })
      res.end(data)
    } catch {
      json(res, 404, { error: 'not-found' })
    }
  }

  function htmlPage(res, status, message) {
    const body = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">`
      + `<title>Remote Control</title>`
      + `<body style="font:16px system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#0b0d12;color:#e8ecf4">`
      + `<p style="padding:24px;text-align:center;max-width:32rem">${message.replace(/[<>&]/g, '')}</p>`
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(body)
  }

  function json(res, status, value) {
    const body = JSON.stringify(value)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    res.end(body)
  }
}

/* ------------------------------------------------------------------ */
/* loopback discovery page                                             */
/* ------------------------------------------------------------------ */

function serveInfo(req, res, published) {
  const headers = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  }
  const host = String(req.headers?.host || '')
  const hostname = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0]
  const local = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  if (!local) {
    res.writeHead(403, headers)
    res.end(renderInfoPage('Local only', '<p class="muted">Open this page from the harness computer itself.</p>'))
    return
  }

  const code = published.code || 'starting…'
  const urls = published.urls.length > 0 ? published.urls : []
  const items = urls.length > 0
    ? urls.map((url) => `<li><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a></li>`).join('')
    : '<li class="muted">starting…</li>'
  const body = `
    <p class="muted">Open one of these addresses on your phone or another computer, then enter the pairing code.</p>
    <ul class="urls">${items}</ul>
    <div class="code" aria-label="Pairing code">${escapeHtml(code)}</div>
    <p class="muted small">The code is stored in <code>remote-control.json</code> inside your DSH home directory. Deleting that file rotates the code and forgets every paired device.</p>`
  res.writeHead(200, headers)
  res.end(renderInfoPage('Remote Control', body, code))
}

function renderInfoPage(title, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark light; --bg:#0b0d12; --fg:#e8ecf4; --muted:#93a0b5; --line:#232936; --accent:#5b8bff; }
  @media (prefers-color-scheme: light) { :root { --bg:#f5f7fb; --fg:#14181f; --muted:#5d6779; --line:#dde2ec; --accent:#2f6bff; } }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg);
         font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; padding:24px; }
  .card { width:100%; max-width:520px; border:1px solid var(--line); border-radius:18px; padding:24px; background:color-mix(in srgb, var(--fg) 3%, var(--bg)); }
  h1 { font-size:18px; margin:0 0 12px; }
  .muted { color:var(--muted); }
  .small { font-size:13px; margin-top:18px; }
  .urls { padding-left:18px; margin:12px 0 18px; }
  .urls a { color:var(--accent); word-break:break-all; }
  .code { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:34px; letter-spacing:.28em;
          text-align:center; padding:14px; border:1px dashed var(--line); border-radius:14px; }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
</style></head>
<body><div class="card"><h1>${escapeHtml(title)}</h1>${body}</div></body></html>`
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]))
}

/* ------------------------------------------------------------------ */
/* approval secret store                                               */
/* ------------------------------------------------------------------ */

/**
 * Peer grants live in the Host credential store as a `grant` record, the
 * sanctioned secret store, with the legacy 0600 JSON file as a fallback: a
 * credential failure may never stop the plugin from starting, and a first run
 * migrates the file content into the record.
 */
function createCredentialStore(ctx, legacyFile, log, key = 'remote-control/peers') {
  const file = {
    async load() {
      try {
        return JSON.parse(await readFile(legacyFile, 'utf8'))
      } catch (error) {
        if (error?.code !== 'ENOENT') log.warn(`[remote-control] could not read ${legacyFile}: ${error?.message || error}`)
        return null
      }
    },
    async save(value) {
      try {
        await mkdir(path.dirname(legacyFile), { recursive: true })
        await writeFile(legacyFile, JSON.stringify(value, null, 2), { mode: 0o600 })
      } catch (error) {
        log.warn(`[remote-control] could not persist ${legacyFile}: ${error?.message || error}`)
      }
    },
  }

  let credentials
  try {
    credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined
  } catch {
    credentials = undefined
  }
  if (!credentials || typeof credentials.readRecord !== 'function' || typeof credentials.modifyRecord !== 'function') {
    return file
  }

  return {
    async load() {
      try {
        const record = await credentials.readRecord(key)
        if (record && record.kind === 'grant' && record.payload) return record.payload
      } catch (error) {
        log.warn(`[remote-control] credential record read failed: ${error?.message || error}`)
      }
      const legacy = await file.load()
      if (legacy) {
        try {
          await credentials.modifyRecord(key, async () => ({ kind: 'grant', payload: legacy }))
          log.info('[remote-control] migrated peer grants into the credential store')
        } catch { /* the file copy remains authoritative */ }
      }
      return legacy
    },
    async save(value) {
      try {
        await credentials.modifyRecord(key, async () => ({ kind: 'grant', payload: value }))
        return
      } catch (error) {
        log.warn(`[remote-control] credential record write failed, using the file fallback: ${error?.message || error}`)
      }
      await file.save(value)
    },
  }
}

/* ------------------------------------------------------------------ */
/* configuration                                                       */
/* ------------------------------------------------------------------ */

function normalizeConfig(raw = {}) {
  const config = {
    host: typeof raw?.host === 'string' && raw.host.trim() ? raw.host.trim() : '0.0.0.0',
    port: Number.isInteger(raw?.port) ? raw.port : 57330,
    // HITL is on by default: without it a remote prompt that needs approval
    // stalls until someone answers at the desktop. `takeover: 'race'` keeps the
    // local prompt (first answer wins); `'claim'` gives the page the only say.
    hitl: {
      enabled: raw?.hitl?.enabled !== false,
      takeover: raw?.hitl?.takeover === 'claim' ? 'claim' : 'race',
    },
    notify: normalizeNotify(raw?.notify),
    publicUrl: typeof raw?.publicUrl === 'string' ? raw.publicUrl.trim() : '',
    trustedHosts: Array.isArray(raw?.trustedHosts) ? raw.trustedHosts.filter((entry) => typeof entry === 'string') : [],
    code: typeof raw?.code === 'string' ? raw.code.trim() : '',
    cookieDays: Number.isFinite(raw?.cookieDays) ? raw.cookieDays : 30,
    defaultCwd: typeof raw?.defaultCwd === 'string' ? raw.defaultCwd.trim() : '',
    discovery: raw?.discovery !== false,
    discoveryPort: Number.isInteger(raw?.discoveryPort) ? raw.discoveryPort : 57331,
    relayUrl: typeof raw?.relayUrl === 'string' ? raw.relayUrl.trim() : '',
    relayKey: typeof raw?.relayKey === 'string' ? raw.relayKey : '',
    allowInsecureRelay: raw?.allowInsecureRelay === true,
    pairCode: typeof raw?.pairCode === 'string' ? raw.pairCode.trim() : '',
    rateMax: Number.isInteger(raw?.rateMax) ? raw.rateMax : 120,
    rateWindowMs: Number.isInteger(raw?.rateWindowMs) ? raw.rateWindowMs : 10_000,
    punchPort: Number.isInteger(raw?.punchPort) ? raw.punchPort : 0,
    stunHost: raw?.stunHost === false ? false : (typeof raw?.stunHost === 'string' ? raw.stunHost : 'stun.l.google.com'),
    stunPort: Number.isInteger(raw?.stunPort) ? raw.stunPort : 19302,
    stunTimeoutMs: Number.isInteger(raw?.stunTimeoutMs) ? raw.stunTimeoutMs : 1500,
    directTimeoutMs: Number.isInteger(raw?.directTimeoutMs) ? raw.directTimeoutMs : 1000,
    streamConnectTimeoutMs: Number.isInteger(raw?.streamConnectTimeoutMs) ? raw.streamConnectTimeoutMs : 2500,
    p2pTimeoutMs: Number.isInteger(raw?.p2pTimeoutMs) ? raw.p2pTimeoutMs : 800,
    routeBlockMs: Number.isInteger(raw?.routeBlockMs) ? raw.routeBlockMs : 60_000,
    allowPlaintextFallback: raw?.allowPlaintextFallback === true,
    service: normalizeServiceConfig(raw?.service),
    deviceName: typeof raw?.deviceName === 'string' && raw.deviceName.trim() ? raw.deviceName.trim() : os.hostname(),
    tls: raw?.tls && typeof raw.tls === 'object' ? { certFile: raw.tls.certFile, keyFile: raw.tls.keyFile } : null,
  }
  if (!(config.port >= 0 && config.port <= 65535)) throw new Error('remote-control: `port` must be 0-65535')
  if (!(config.discoveryPort >= 1 && config.discoveryPort <= 65535)) throw new Error('remote-control: `discoveryPort` must be 1-65535')
  if (config.code && !/^\d{4,12}$/.test(config.code)) throw new Error('remote-control: `code` must be 4-12 digits')
  if (config.cookieDays <= 0) throw new Error('remote-control: `cookieDays` must be positive')
  if (config.tls && (!config.tls.certFile || !config.tls.keyFile)) throw new Error('remote-control: `tls` needs both certFile and keyFile')
  if (config.publicUrl) {
    try {
      new URL(config.publicUrl)
    } catch {
      throw new Error('remote-control: `publicUrl` must be an absolute http(s) URL')
    }
  }
  if (config.relayUrl) {
    const verdict = checkRelayUrl(config.relayUrl, { allowInsecure: config.allowInsecureRelay })
    if (!verdict.ok) throw new Error(`remote-control: ${verdict.message}`)
    if (!config.relayKey || config.relayKey.length < 16) {
      throw new Error('remote-control: `relayKey` must be at least 16 characters when `relayUrl` is set')
    }
  }
  return config
}

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

async function loadState(file, config, log) {
  let persisted
  try {
    persisted = JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') log.warn(`[remote-control] could not read ${file}: ${error?.message || error}`)
  }
  if (persisted && typeof persisted.secret === 'string' && persisted.secret.length >= 32) {
    const state = {
      secret: persisted.secret,
      code: config.code || (typeof persisted.code === 'string' ? persisted.code : generateCode()),
      createdAt: persisted.createdAt ?? Date.now(),
      deviceId: typeof persisted.deviceId === 'string' && persisted.deviceId ? persisted.deviceId : newDeviceId(),
      setup: persisted.setup && typeof persisted.setup === 'object' ? persisted.setup : { completed: false },
    }
    if (state.deviceId !== persisted.deviceId) await persistState(file, state, log)
    return state
  }
  const state = {
    secret: randomBytes(32).toString('hex'),
    code: config.code || generateCode(),
    createdAt: Date.now(),
    deviceId: newDeviceId(),
    setup: { completed: false },
  }
  await persistState(file, state, log)
  return state
}

async function persistState(file, state, log) {
  try {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(state, null, 2), { mode: 0o600 })
  } catch (error) {
    log.warn(`[remote-control] could not persist ${file}: ${error?.message || error}`)
  }
}

function newDeviceId() {
  return `dsh-${randomBytes(8).toString('hex')}`
}

function generateCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function generatePairCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function timeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return undefined }
}

function firstString(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return ''
}

function pickLogger(ctx) {
  const candidate = typeof ctx?.logger === 'function' ? safely(() => ctx.logger('remote-control')) : ctx?.logger
  if (candidate && typeof candidate.info === 'function') return candidate
  return console
}

function safely(fn) {
  try { return fn() } catch { return undefined }
}

/* ------------------------------------------------------------------ */
/* authentication                                                      */
/* ------------------------------------------------------------------ */

function parseCookies(header) {
  const jar = {}
  if (typeof header !== 'string') return jar
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    jar[part.slice(0, index).trim()] = part.slice(index + 1).trim()
  }
  return jar
}

function hmac(secret, value) {
  return createHmac('sha256', secret).update(value).digest('hex')
}

function issueToken(secret, days) {
  const expires = Date.now() + Math.max(1, days) * 86_400_000
  return `${expires}.${hmac(secret, String(expires))}`
}

function isAuthenticated(req, secret) {
  const raw = parseCookies(req.headers?.cookie)[COOKIE_NAME]
  if (!raw) return false
  const dot = raw.lastIndexOf('.')
  if (dot <= 0) return false
  const expires = raw.slice(0, dot)
  const signature = raw.slice(dot + 1)
  if (!/^\d{1,16}$/.test(expires) || Number(expires) < Date.now()) return false
  const expected = Buffer.from(hmac(secret, expires), 'hex')
  const actual = Buffer.from(signature, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function constantTimeEquals(value, expected) {
  const left = Buffer.from(String(value))
  const right = Buffer.from(String(expected))
  return left.length === right.length && timingSafeEqual(left, right)
}

const attempts = new Map()

function clientIp(req) {
  return String(req.socket?.remoteAddress || 'unknown')
}

function tooManyAttempts(ip) {
  const entry = attempts.get(ip)
  if (!entry) return false
  if (entry.resetAt < Date.now()) { attempts.delete(ip); return false }
  return entry.failures >= 10
}

function recordFailure(ip) {
  const now = Date.now()
  const entry = attempts.get(ip)
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { failures: 1, resetAt: now + 10 * 60_000 })
    return
  }
  entry.failures += 1
}

function recordSuccess(ip) {
  attempts.delete(ip)
}

/* ------------------------------------------------------------------ */
/* request trust                                                       */
/* ------------------------------------------------------------------ */

function hostAllowed(header, config) {
  const host = String(header || '').trim()
  if (!host) return false
  const hostname = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0]
  const name = hostname.toLowerCase()
  if (!name) return false
  if (name === 'localhost') return true
  if (config.publicUrl) {
    try {
      if (new URL(config.publicUrl).hostname.toLowerCase() === name) return true
    } catch { /* ignore */ }
  }
  if (config.trustedHosts.some((entry) => entry.toLowerCase() === name || entry.toLowerCase() === host.toLowerCase())) return true
  if (isIP(name)) {
    if (name === '127.0.0.1' || name === '::1') return true
    return isWildcard(config.host) || normalizeAddress(name) === normalizeAddress(config.host)
  }
  return false
}

function sameOrigin(req, config) {
  const origin = req.headers?.origin
  if (!origin || origin === 'null') return true
  try {
    const parsed = new URL(origin)
    const host = String(req.headers.host || '').toLowerCase()
    if (parsed.host.toLowerCase() === host) return true
    if (config.publicUrl && parsed.host.toLowerCase() === new URL(config.publicUrl).host.toLowerCase()) return true
    return false
  } catch {
    return false
  }
}

/**
 * The Devices panel talks to this Host half through the GUI's own origin.
 * Same-origin browser fetches are allowed; a non-browser caller must be local.
 */
function consoleAllowed(req) {
  const site = req.headers?.['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false
  if (!site && !isLoopbackAddress(req.socket?.remoteAddress)) return false
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers?.origin
    if (typeof origin === 'string' && origin && origin !== 'null') {
      try {
        if (new URL(origin).host !== String(req.headers.host || '')) return false
      } catch {
        return false
      }
    }
  }
  return true
}

function isLoopbackAddress(address) {
  const value = String(address || '')
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1'
}

function isWildcard(host) {
  return host === '0.0.0.0' || host === '::' || host === '*'
}

function normalizeAddress(value) {
  return String(value).toLowerCase().replace(/^\[|\]$/g, '')
}

function accessUrls(config, port, scheme) {
  if (config.publicUrl) return [config.publicUrl.replace(/\/+$/, '') + '/']
  if (!isWildcard(config.host)) return [`${scheme}://${formatHost(config.host)}:${port}/`]
  const addresses = []
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue
      if (entry.family !== 'IPv4' && entry.family !== 4) continue
      addresses.push(`${scheme}://${entry.address}:${port}/`)
    }
  }
  if (addresses.length === 0) addresses.push(`${scheme}://127.0.0.1:${port}/`)
  return addresses
}

function formatHost(host) {
  return host.includes(':') ? `[${host}]` : host
}

/* ------------------------------------------------------------------ */
/* request helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * Read the plugin's own settings file. The Desktop app rewrites the profile
 * patch layer on startup and drops rows it does not own, so anything that must
 * survive a restart is kept here instead.
 */
function readSettingsFile(file, log) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (error) {
    if (error?.code !== 'ENOENT') log?.warn?.(`[remote-control] could not read ${file}: ${error?.message || error}`)
    return {}
  }
}

/** Overlay the settings file onto the config the patch layer supplied. */
function applySettingsOverrides(config, overrides) {
  if (!overrides || typeof overrides !== 'object') return
  const hitl = overrides.hitl
  if (hitl && typeof hitl === 'object') {
    if (hitl.takeover === 'claim' || hitl.takeover === 'race') config.hitl.takeover = hitl.takeover
    if (typeof hitl.enabled === 'boolean') config.hitl.enabled = hitl.enabled
  }
  if (overrides.notify && typeof overrides.notify === 'object') {
    config.notify = normalizeNotify({ ...config.notify, ...overrides.notify })
  }
  // Each machine advertises its own reachable name (a tailnet MagicDNS name, for
  // example), so requests arriving under that name are not rejected as rebinding.
  if (typeof overrides.publicUrl === 'string') config.publicUrl = overrides.publicUrl.trim()
  if (Array.isArray(overrides.trustedHosts)) {
    const extra = overrides.trustedHosts.filter((entry) => typeof entry === 'string' && entry.trim() !== '')
    config.trustedHosts = [...new Set([...(config.trustedHosts ?? []), ...extra])]
  }
}

function contentText(content) {
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => (block && block.type === 'text' ? String(block.text ?? '') : ''))
    .join('')
    .trim()
}

function readJson(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

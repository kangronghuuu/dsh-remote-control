import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { networkInterfaces } from 'node:os'

/**
 * Remote Control as a Service (0.5.0), phase 1.
 *
 * Keeps the plugin listener reachable without a manual ritual: it selects a
 * provider (configured relay, cloudflared tunnel with a named token, quick
 * tunnel, an already-public URL, or LAN-only), publishes one service snapshot
 * for /state and the Devices card, and supervises the tunnel child process
 * (health checks, exponential backoff, bounded log ring).
 *
 * Deliberately dependency-free: the tunnel binary is user/installer supplied;
 * the core never downloads one.
 */

export const SERVICE_DEFAULTS = {
  enabled: false,
  provider: 'auto', // auto | relay | tunnel | lan-only
  relayUrl: '',
  relayKey: '',
  publicUrl: '',
  tunnel: {
    kind: 'cloudflared', // cloudflared | none
    binary: '',
    tokenFile: '',
    urlPattern: '',
  },
  autoReconnect: true,
  healthIntervalMs: 30_000,
  healthTimeoutMs: 5_000,
  advertise: true,
  maxRestarts: 5,
  restartBaseMs: 1_000,
  interfaceWatchMs: 10_000,
}

function withDefaults(raw = {}) {
  const tunnel = { ...SERVICE_DEFAULTS.tunnel, ...(raw?.tunnel ?? {}) }
  return {
    ...SERVICE_DEFAULTS,
    ...Object.fromEntries(Object.entries(raw ?? {}).filter(([, value]) => value !== undefined)),
    tunnel,
    provider: ['auto', 'relay', 'tunnel', 'lan-only'].includes(raw?.provider) ? raw.provider : 'auto',
  }
}

export function normalizeServiceConfig(raw) {
  const config = withDefaults(raw)
  return {
    enabled: config.enabled === true,
    provider: config.provider,
    relayUrl: typeof config.relayUrl === 'string' ? config.relayUrl.trim() : '',
    relayKey: typeof config.relayKey === 'string' ? config.relayKey : '',
    publicUrl: typeof config.publicUrl === 'string' ? config.publicUrl.trim() : '',
    tunnel: {
      kind: config.tunnel.kind === 'none' ? 'none' : 'cloudflared',
      binary: typeof config.tunnel.binary === 'string' ? config.tunnel.binary : '',
      tokenFile: typeof config.tunnel.tokenFile === 'string' ? config.tunnel.tokenFile : '',
      urlPattern: typeof config.tunnel.urlPattern === 'string' ? config.tunnel.urlPattern : '',
      provision: typeof config.tunnel.provision === 'string' ? config.tunnel.provision : 'verified-download',
      downloadTimeoutMs: Number.isInteger(config.tunnel.downloadTimeoutMs) ? config.tunnel.downloadTimeoutMs : 300_000,
      installDir: typeof config.tunnel.installDir === 'string' ? config.tunnel.installDir : '',
    },
    autoReconnect: config.autoReconnect !== false,
    healthIntervalMs: Number.isInteger(config.healthIntervalMs) ? config.healthIntervalMs : 30_000,
    healthTimeoutMs: Number.isInteger(config.healthTimeoutMs) ? config.healthTimeoutMs : 5_000,
    advertise: config.advertise !== false,
    maxRestarts: Number.isInteger(config.maxRestarts) ? config.maxRestarts : 5,
    restartBaseMs: Number.isInteger(config.restartBaseMs) ? config.restartBaseMs : 1_000,
    interfaceWatchMs: Number.isInteger(config.interfaceWatchMs) ? config.interfaceWatchMs : 10_000,
  }
}

function defaultHealthCheck(endpoint, timeoutMs) {
  return new Promise((resolve) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    timer.unref?.()
    fetch(endpoint, { method: 'GET', redirect: 'manual', signal: controller.signal })
      .then((response) => { clearTimeout(timer); resolve(response.status < 500) })
      .catch(() => { clearTimeout(timer); resolve(false) })
  })
}

function addressSet(getInterfaces) {
  try {
    const interfaces = getInterfaces() ?? {}
    const addresses = []
    for (const entries of Object.values(interfaces)) {
      for (const entry of entries ?? []) {
        if (entry && !entry.internal && entry.address) addresses.push(entry.address)
      }
    }
    return addresses.sort().join(',')
  } catch {
    return ''
  }
}

export function createServiceManager({
  config: rawConfig,
  localPort,
  log = console,
  spawnImpl = spawn,
  healthCheck = defaultHealthCheck,
  getInterfaces = networkInterfaces,
  onAddressChange,
  provisioner,
  now = () => Date.now(),
} = {}) {
  const config = normalizeServiceConfig(rawConfig)
  const portOf = typeof localPort === 'function' ? localPort : () => localPort
  const state = {
    enabled: config.enabled,
    provider: 'lan-only',
    endpoint: '',
    healthy: false,
    since: null,
    lastError: null,
    restarts: 0,
    lastHealthAt: null,
    lastInterfaceChange: null,
    logs: [],
  }

  let modeOverride
  let child
  let stopping = false
  let restartTimer
  let healthTimer
  let interfaceTimer
  let lastAddresses = addressSet(getInterfaces)

  const clamp = (list) => (list.length > 50 ? list.slice(list.length - 50) : list)
  function record(source, line) {
    const text = String(line ?? '').trim()
    if (!text) return
    state.logs = clamp([...state.logs, `${source}: ${text}`])
  }
  function setError(code, message) {
    state.lastError = { code, message, at: now() }
    state.healthy = false
    log.warn?.(`[remote-control] service: ${code}: ${message}`)
  }
  function setEndpoint(endpoint) {
    state.endpoint = endpoint
    state.since = now()
    state.provider = 'tunnel'
    log.info?.(`[remote-control] service endpoint: ${endpoint}`)
  }

  function tunnelBinary() {
    const installed = provisioner?.binaryPath?.()
    if (installed) return installed
    if (config.tunnel.binary) return config.tunnel.binary
    if (process.env?.CLOUDFLARED_PATH) return process.env.CLOUDFLARED_PATH
    return 'cloudflared'
  }

  function tunnelArgs() {
    if (config.tunnel.tokenFile) {
      return ['tunnel', '--no-autoupdate', 'run', '--token-file', config.tunnel.tokenFile]
    }
    return ['tunnel', '--url', `http://127.0.0.1:${portOf()}`, '--no-autoupdate']
  }

  function endpointPattern() {
    if (config.tunnel.urlPattern) {
      try { return new RegExp(config.tunnel.urlPattern) } catch { /* fall through */ }
    }
    return /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i
  }

  function scheduleHealth() {
    clearInterval(healthTimer)
    if (!state.endpoint) return
    healthTimer = setInterval(probeHealth, config.healthIntervalMs)
    healthTimer.unref?.()
  }

  async function probeHealth() {
    if (!state.endpoint) return
    const endpoint = state.endpoint.replace(/\/+$/, '')
    const healthy = await healthCheck(endpoint, config.healthTimeoutMs)
    state.healthy = healthy
    state.lastHealthAt = now()
    if (!healthy) {
      setError('unhealthy', `No healthy response from ${endpoint}`)
      if (config.autoReconnect && child) restartTunnel('unhealthy')
    }
  }

  function stopChild() {
    if (!child) return
    try { child.kill('SIGTERM') } catch { /* already gone */ }
    child = undefined
  }

  function scheduleRestart(reason) {
    clearTimeout(restartTimer)
    state.restarts += 1
    if (state.restarts > config.maxRestarts) {
      setError('tunnel-restarts-exhausted', `Tunnel exited ${state.restarts} times (${reason})`)
      state.provider = 'lan-only'
      state.endpoint = ''
      return
    }
    const delay = Math.min(config.restartBaseMs * 2 ** (state.restarts - 1), 30_000)
    log.warn?.(`[remote-control] service: restarting tunnel in ${delay}ms (${reason})`)
    restartTimer = setTimeout(() => { startTunnel().catch(() => {}) }, delay)
    restartTimer.unref?.()
  }

  function startTunnel() {
    return new Promise((resolve) => {
      if (config.tunnel.kind === 'none') {
        setError('tunnel-disabled', 'tunnel.kind is none')
        resolve(false)
        return
      }
      const binary = tunnelBinary()
      if (config.tunnel.binary && !existsSync(config.tunnel.binary)) {
        state.provision = provisioner?.plan?.() ?? null
        setError('tunnel-binary-missing', `Tunnel binary not found at ${config.tunnel.binary}`)
        resolve(false)
        return
      }
      let spawned
      try {
        spawned = spawnImpl(binary, tunnelArgs(), { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      } catch (error) {
        setError('tunnel-spawn-failed', `${error?.message || error}`)
        resolve(false)
        return
      }
      child = spawned
      state.provider = 'tunnel'
      state.enabled = true
      const pattern = endpointPattern()
      const consume = (source) => (buffer) => {
        for (const line of String(buffer ?? '').split(/\r?\n/)) {
          if (!line.trim()) continue
          record(source, line)
          const match = line.match(pattern)
          if (match && !state.endpoint) {
            setEndpoint(match[0])
            state.healthy = true
            state.lastError = null
            scheduleHealth()
            resolve(true)
          }
        }
      }
      spawned.stdout?.on?.('data', consume('out'))
      spawned.stderr?.on?.('data', consume('err'))
      spawned.on?.('error', (error) => {
        if (error?.code === 'ENOENT') {
          state.provision = provisioner?.plan?.() ?? null
          setError('tunnel-binary-missing', `Cannot execute ${binary}`)
        }
        else setError('tunnel-error', `${error?.message || error}`)
        if (!stopping) scheduleRestart('spawn-error')
        resolve(false)
      })
      spawned.on?.('exit', (code, signal) => {
        record('exit', `code=${code} signal=${signal}`)
        child = undefined
        state.healthy = false
        state.endpoint = ''
        if (!stopping) scheduleRestart(`exit ${code ?? signal}`)
      })
      // A named tunnel knows its public URL up front.
      if (config.tunnel.tokenFile && config.publicUrl) {
        setEndpoint(config.publicUrl)
        state.healthy = true
        scheduleHealth()
        resolve(true)
      }
    })
  }

  async function start() {
    state.enabled = true
    state.restarts = 0
    state.lastError = null
    const provider = modeOverride?.provider ?? config.provider
    const relayUrl = modeOverride?.relayUrl || config.relayUrl
    const publicUrl = modeOverride?.publicUrl || config.publicUrl

    if (provider === 'lan-only') {
      state.provider = 'lan-only'
      state.since = now()
      return snapshot()
    }
    if (provider === 'relay' || (provider === 'auto' && relayUrl)) {
      if (relayUrl) {
        state.provider = 'relay'
        state.endpoint = relayUrl
        state.healthy = true
        state.since = now()
        return snapshot()
      }
      if (provider === 'relay') { setError('relay-missing', 'provider is relay but relayUrl is empty'); return snapshot() }
    }
    if (publicUrl) {
      state.provider = 'tunnel'
      state.endpoint = publicUrl
      state.healthy = await healthCheck(publicUrl, config.healthTimeoutMs)
      state.since = now()
      if (state.healthy) return snapshot()
      setError('public-url-unhealthy', `No healthy response from ${publicUrl}`)
      if (!config.autoReconnect || provider === 'tunnel') return snapshot()
    }
    if (provider === 'tunnel' || provider === 'auto') {
      const ok = await startTunnel()
      if (ok) return snapshot()
    }
    if (!state.endpoint) {
      state.provider = 'lan-only'
      state.since = state.since ?? now()
    }
    return snapshot()
  }

  function restartTunnel(reason) {
    stopChild()
    state.healthy = false
    state.endpoint = ''
    scheduleRestart(reason)
  }

  function stop() {
    stopping = true
    clearTimeout(restartTimer)
    clearInterval(healthTimer)
    clearInterval(interfaceTimer)
    stopChild()
    state.healthy = false
    state.endpoint = ''
    state.provider = 'lan-only'
    state.enabled = false
    return snapshot()
  }

  function watchInterfaces() {
    if (config.interfaceWatchMs <= 0) return
    interfaceTimer = setInterval(() => {
      const next = addressSet(getInterfaces)
      if (next === lastAddresses) return
      lastAddresses = next
      state.lastInterfaceChange = now()
      log.info?.('[remote-control] service: interface set changed')
      if (config.advertise) {
        onAddressChange?.()
        if (child) restartTunnel('interface-change')
      }
    }, config.interfaceWatchMs)
    interfaceTimer.unref?.()
  }

  function setMode(input) {
    if (!input || typeof input !== 'object') { modeOverride = undefined; return snapshot() }
    const provider = ['auto', 'relay', 'tunnel', 'lan-only'].includes(input.provider) ? input.provider : config.provider
    modeOverride = {
      provider,
      relayUrl: typeof input.relayUrl === 'string' ? input.relayUrl : '',
      publicUrl: typeof input.publicUrl === 'string' ? input.publicUrl : '',
    }
    return snapshot()
  }

  function snapshot() {
    return {
      enabled: state.enabled,
      provider: state.provider,
      endpoint: state.endpoint,
      // `lan-only` publishes no endpoint on purpose, so the health probe has
      // nothing to check; reporting it as unhealthy made the Devices panel show
      // a red badge for the normal, working configuration.
      healthy: state.provider === 'lan-only' ? true : state.healthy,
      since: state.since,
      lastError: state.lastError,
      restarts: state.restarts,
      lastHealthAt: state.lastHealthAt,
      lastInterfaceChange: state.lastInterfaceChange,
      logs: state.logs.slice(-10),
      provision: state.provision ?? provisioner?.plan?.() ?? null,
      modeSource: modeOverride ? 'runtime' : 'config',
      config: {
        provider: config.provider,
        tunnelKind: config.tunnel.kind,
        relayConfigured: Boolean(config.relayUrl),
        publicUrlConfigured: Boolean(config.publicUrl),
      },
    }
  }

  watchInterfaces()

  return { start, stop, snapshot, probeHealth, setMode }
}

import dgram from 'node:dgram'
import http from 'node:http'
import os from 'node:os'

/**
 * Relay reachability and address policy.
 *
 * A relay is only usable across NATs when it has a public address. This module
 * tries, in order, to make this Host reachable and to prove it:
 *   1. UPnP IGD port mapping, then the router's external address;
 *   2. an HTTP public-address lookup (display only — no mapping);
 *   3. a self-test that talks to the relay over its public URL.
 *
 * It never adds a third-party dependency: SSDP and SOAP are plain UDP/HTTP.
 */

const PRIVATE = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^::1$/,
  /^f[cd][0-9a-f]{2}:/i,
]

export function isPrivateHost(host) {
  const value = String(host || '').replace(/^\[|\]$/g, '').toLowerCase()
  if (!value) return false
  if (value === 'localhost') return true
  return PRIVATE.some((pattern) => pattern.test(value))
}

/**
 * Relay addresses must be TLS unless they stay on this machine or a private
 * network. A public plain-HTTP relay would expose the workspace key and every
 * signed call in transit.
 */
export function checkRelayUrl(rawUrl, { allowInsecure = false } = {}) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, error: 'bad-url', message: 'Relay URL must be absolute.' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'bad-protocol', message: 'Relay URL must use http or https.' }
  }
  if (url.protocol === 'https:') return { ok: true, url }
  if (isPrivateHost(url.hostname)) return { ok: true, url, insecure: true }
  if (allowInsecure) return { ok: true, url, insecure: true, warning: 'Plain HTTP to a public relay: traffic is readable in transit.' }
  return {
    ok: false,
    error: 'tls-required',
    message: 'A public relay must use https. Enable allowInsecureRelay only for a network you trust.',
  }
}

/** The address this machine would use to reach the internet. */
export function primaryAddress() {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4')
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      try { socket.close() } catch { /* ignore */ }
      resolve(value)
    }
    socket.on('error', () => done(undefined))
    try {
      socket.connect(53, '8.8.8.8', () => {
        const address = socket.address()
        done(address?.address)
      })
    } catch {
      done(undefined)
    }
    setTimeout(() => done(undefined), 1500).unref?.()
  })
}

const SSDP_SEARCH = Buffer.from(
  'M-SEARCH * HTTP/1.1\r\n'
  + 'HOST: 239.255.255.250:1900\r\n'
  + 'MAN: "ssdp:discover"\r\n'
  + 'MX: 2\r\n'
  + 'ST: urn:schemas-upnp-org:service:WANIPConnection:1\r\n\r\n',
)

/** Discover UPnP internet-gateway devices (SSDP). */
export function discoverGateways({ timeoutMs = 2500 } = {}) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4')
    const locations = new Set()
    socket.on('message', (message) => {
      const location = /LOCATION:\s*(\S+)/i.exec(message.toString('utf8'))?.[1]
      if (location) locations.add(location)
    })
    socket.on('error', () => { try { socket.close() } catch { /* ignore */ } resolve([]) })
    socket.bind(() => {
      try { socket.setBroadcast(true) } catch { /* ignore */ }
      socket.send(SSDP_SEARCH, 0, SSDP_SEARCH.length, 1900, '239.255.255.250')
    })
    setTimeout(() => {
      try { socket.close() } catch { /* ignore */ }
      resolve([...locations])
    }, timeoutMs).unref?.()
  })
}

const fetchText = (url, options = {}, timeoutMs = 4000) => new Promise((resolve, reject) => {
  const request = http.request(url, { ...options, timeout: timeoutMs }, (response) => {
    let body = ''
    response.on('data', (chunk) => { body += chunk })
    response.on('end', () => resolve({ status: response.statusCode ?? 0, body }))
  })
  request.on('timeout', () => request.destroy(new Error('timeout')))
  request.on('error', reject)
  if (options.body) request.write(options.body)
  request.end()
})

function soapRequest(controlUrl, service, action, args) {
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${service}">${args}</u:${action}></s:Body></s:Envelope>`
  return fetchText(controlUrl, {
    method: 'POST',
    headers: {
      'content-type': 'text/xml; charset="utf-8"',
      soapaction: `"${service}#${action}"`,
      'content-length': Buffer.byteLength(body),
    },
    body,
  })
}

/**
 * Ask the router to forward a TCP port to this machine and report its external
 * address. Returns `{ available: false }` when there is no IGD to talk to.
 */
export async function mapUpnpPort({ port, internalIp, description = 'DSH remote control', leaseSeconds = 0 }) {
  const locations = await discoverGateways()
  if (locations.length === 0) {
    return { available: false, error: 'no-igd', message: 'No UPnP internet gateway answered on this network.' }
  }
  for (const location of locations) {
    try {
      const description0 = await fetchText(location)
      const service = /urn:schemas-upnp-org:service:(WANIPConnection|WANPPPConnection):\d/.exec(description0.body)?.[1]
      const controlPath = /<controlURL>([^<]+)<\/controlURL>/i.exec(description0.body)?.[1]
      if (!service || !controlPath) continue
      const serviceType = `urn:schemas-upnp-org:service:${service}:1`
      const controlUrl = new URL(controlPath, location).toString()
      const address = await soapRequest(controlUrl, serviceType, 'AddPortMapping', [
        '<NewRemoteHost></NewRemoteHost>',
        `<NewExternalPort>${port}</NewExternalPort>`,
        '<NewProtocol>TCP</NewProtocol>',
        `<NewInternalPort>${port}</NewInternalPort>`,
        `<NewInternalClient>${internalIp}</NewInternalClient>`,
        '<NewEnabled>1</NewEnabled>',
        `<NewPortMappingDescription>${description}</NewPortMappingDescription>`,
        `<NewLeaseDuration>${leaseSeconds}</NewLeaseDuration>`,
      ].join(''))
      if (address.status !== 200) continue
      const ip = await soapRequest(controlUrl, serviceType, 'GetExternalIPAddress', '')
      const externalIp = /<NewExternalIPAddress>([^<]+)<\/NewExternalIPAddress>/.exec(ip.body)?.[1]
      return {
        available: true,
        mapped: true,
        controlUrl,
        serviceType,
        externalIp: externalIp && externalIp !== '0.0.0.0' ? externalIp : undefined,
      }
    } catch { /* try the next gateway */ }
  }
  return { available: true, mapped: false, error: 'map-failed', message: 'The gateway refused the port mapping.' }
}

export async function removeUpnpMapping({ controlUrl, serviceType, port }) {
  try {
    await soapRequest(controlUrl, serviceType, 'DeletePortMapping', [
      '<NewRemoteHost></NewRemoteHost>',
      `<NewExternalPort>${port}</NewExternalPort>`,
      '<NewProtocol>TCP</NewProtocol>',
    ].join(''))
  } catch { /* best effort */ }
}

/** Public address via an HTTP echo service; display only, no mapping. */
export async function publicAddressViaHttp() {
  try {
    const response = await fetchText('http://api.ipify.org', {}, 3000)
    const value = response.body.trim()
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(value) ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Prove a relay is reachable at `url`: POST /v1/register with no group.
 * A reachable relay answers 400 (bad-group); anything else means we cannot
 * talk to it from outside.
 */
export async function relaySelfTest(url, timeoutMs = 4000) {
  try {
    const response = await fetchText(`${String(url).replace(/\/+$/, '')}/v1/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': 2 },
      body: '{}',
    }, timeoutMs)
    return { ok: response.status === 400, status: response.status }
  } catch (error) {
    return { ok: false, error: error?.message || String(error) }
  }
}

/**
 * Full reachability attempt for a relay hosted on `port`.
 * Returns the public URL only when the relay actually answers through it.
 */
export async function ensureReachable({ port, allowInsecure = false } = {}) {
  const internalIp = await primaryAddress()
  const upnp = await mapUpnpPort({ port, internalIp: internalIp ?? '0.0.0.0' })
  const publicIp = upnp.externalIp ?? (await publicAddressViaHttp())

  const candidates = []
  if (publicIp) candidates.push(`http://${publicIp}:${port}`)

  let selfTest = { ok: false, error: 'no-public-address' }
  let reachableUrl
  for (const candidate of candidates) {
    const verdict = await relaySelfTest(candidate)
    selfTest = verdict
    if (verdict.ok) { reachableUrl = candidate; break }
  }

  const secure = reachableUrl ? checkRelayUrl(reachableUrl, { allowInsecure }) : { ok: false }

  return {
    ok: Boolean(reachableUrl && secure.ok),
    url: reachableUrl ?? null,
    secure: Boolean(secure.ok),
    publicIp: publicIp ?? null,
    internalIp: internalIp ?? null,
    upnp,
    selfTest,
    hint: upnp.available
      ? (upnp.mapped ? undefined : upnp.message)
      : 'No UPnP gateway on this network; the relay cannot be published from here. Use a public relay or a tunnel.',
  }
}

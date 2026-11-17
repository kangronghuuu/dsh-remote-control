/**
 * Tailscale detection.
 *
 * The plugin never requires Tailscale, but when this machine is already on a
 * tailnet its MagicDNS name is the best address to advertise: every device in
 * the same tailnet can reach it directly, with no public exposure and no
 * port forwarding. Machines without Tailscale keep working over LAN, relay or
 * tunnel exactly as before.
 */
import { execFile } from 'node:child_process'

const CANDIDATES = [
  'tailscale',
  'C:\\Program Files\\Tailscale\\tailscale.exe',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/usr/bin/tailscale',
  '/usr/local/bin/tailscale',
]

const defaultRun = (file, args, options) => new Promise((resolve, reject) => {
  execFile(file, args, { ...options, windowsHide: true }, (error, stdout, stderr) => {
    if (error) reject(new Error(stderr || error.message))
    else resolve({ stdout })
  })
})

/**
 * Ask the local Tailscale daemon who we are.
 * Returns `{ available: false }` when the CLI is missing or declines.
 */
export async function detectTailnet({ timeoutMs = 4000, run = defaultRun, candidates = CANDIDATES } = {}) {
  for (const bin of candidates) {
    let stdout
    try {
      ({ stdout } = await run(bin, ['status', '--json'], { timeout: timeoutMs }))
    } catch {
      continue
    }
    let doc
    try { doc = JSON.parse(stdout) } catch { continue }
    const rawName = typeof doc?.Self?.DNSName === 'string' ? doc.Self.DNSName : ''
    if (!rawName) continue
    const dnsName = rawName.replace(/\.$/, '')
    const ips = Array.isArray(doc?.Self?.TailscaleIPs) ? doc.Self.TailscaleIPs : []
    const certDomains = Array.isArray(doc?.CertDomains) ? doc.CertDomains : []
    const suffix = typeof doc?.MagicDNSSuffix === 'string' ? doc.MagicDNSSuffix.replace(/\.$/, '') : ''
    const peers = Object.values(doc?.Peer ?? {})
      .filter((peer) => peer && typeof peer.DNSName === 'string' && peer.DNSName !== '')
      .filter((peer) => suffix === '' || peer.DNSName.replace(/\.$/, '').endsWith(`.${suffix}`))
      .map((peer) => ({
        dnsName: peer.DNSName.replace(/\.$/, ''),
        ip: Array.isArray(peer.TailscaleIPs) && typeof peer.TailscaleIPs[0] === 'string' ? peer.TailscaleIPs[0] : '',
        online: peer.Online === true,
        hostName: typeof peer.HostName === 'string' ? peer.HostName : '',
      }))
    return {
      available: true,
      bin,
      dnsName,
      ip: typeof ips[0] === 'string' ? ips[0] : '',
      hasCert: certDomains.some((entry) => String(entry).replace(/\.$/, '') === dnsName),
      magicDnsSuffix: suffix,
      peers,
    }
  }
  return { available: false }
}

/** The address other tailnet devices should use, or '' when there is none. */
export function tailnetUrl(tailnet, port) {
  if (!tailnet?.available || !tailnet.dnsName) return ''
  const value = Number(port)
  if (!Number.isInteger(value) || value <= 0) return ''
  return tailnet.hasCert ? `https://${tailnet.dnsName}` : `http://${tailnet.dnsName}:${value}`
}

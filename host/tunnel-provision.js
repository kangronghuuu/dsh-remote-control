import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * cloudflared provisioning (0.5.1, "verified-download" policy).
 *
 * The core never downloads on its own: install() requires an explicit
 * consent:true from the user's click. The artifact is pinned here (version,
 * URL, SHA-256 per platform; hashes are GitHub's server-computed asset
 * digests), the download is streamed to a temp file, the hash is verified, and
 * only then is the binary moved into place with a provenance record. A mismatch
 * deletes the temp file and never touches the installed binary.
 */

export const PROVENANCE_VERSION = '2026.11.0'

const RELEASE = 'https://github.com/cloudflare/cloudflared/releases/download'

export const TUNNEL_MANIFEST = {
  version: PROVENANCE_VERSION,
  assets: {
    'win32-x64': { name: 'cloudflared-windows-amd64.exe', sha256: 'd5c1d82031da6253dcdcff64c944cd0fe063016edeb2e4fd088075fc9bd52d0a' },
    'win32-ia32': { name: 'cloudflared-windows-386.exe', sha256: 'dbefbddfe99cf4b6d0fc3bd1b8a7b120d5d207a33e3669b95116f4aa7c130062' },
    'darwin-x64': { name: 'cloudflared-darwin-amd64.tgz', sha256: '8a59d51120cebbe902f0a8d6e1b7a7fd4f9a5bb4dcb3e0f05872483e75e7db6b', archive: 'tgz' },
    'darwin-arm64': { name: 'cloudflared-darwin-arm64.tgz', sha256: '8c2f90277ef06a6080bb40b964d33f09f1188102f8798f2e344174b6cf41accf', archive: 'tgz' },
    'linux-x64': { name: 'cloudflared-linux-amd64', sha256: '51f7c68b57ed7269164075d7e789efce5b59355982f06392deeb037d982a51fd' },
    'linux-arm64': { name: 'cloudflared-linux-arm64', sha256: 'abe54a006acf9faf2d19ee9d953cb0d0804e92f59c5382a162e57b84d086f56f' },
    'linux-arm': { name: 'cloudflared-linux-arm', sha256: '57f6a61df47583ccd5c3507b87964820adccb1f9fd35f311417c7872004dc368' },
    'linux-ia32': { name: 'cloudflared-linux-386', sha256: '41214a0422b0edb9f17c7355ee7ea2c4c7575e07bd57ad7d88a0aec062226e20' },
  },
}

export const PROVISION_MODES = ['manual', 'prompt', 'verified-download']

export function assetFor(platform = process.platform, arch = process.arch, manifest = TUNNEL_MANIFEST) {
  const key = `${platform}-${arch}`
  const asset = manifest.assets[key]
  if (!asset) return undefined
  return {
    ...asset,
    key,
    url: `${RELEASE}/${manifest.version}/${asset.name}`,
  }
}

export function installGuide(platform = process.platform) {
  if (platform === 'darwin') return 'brew install cloudflared   (or set service.tunnel.binary)'
  if (platform === 'win32') return 'winget install --id Cloudflare.cloudflared   (or set service.tunnel.binary)'
  return 'Use your distribution package, the Cloudflare apt/rpm repo, or set service.tunnel.binary'
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const reader = createReadStream(file)
    reader.on('data', (chunk) => hash.update(chunk))
    reader.on('error', reject)
    reader.on('end', () => resolve(hash.digest('hex')))
  })
}

async function defaultDownload(url, destination, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`)
    const body = Buffer.from(await response.arrayBuffer())
    await writeFile(destination, body)
  } finally {
    clearTimeout(timer)
  }
}

async function extractTgz(archive, outDir) {
  const { spawn } = await import('node:child_process')
  await new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xzf', archive, '-C', outDir], { stdio: 'ignore', windowsHide: true })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited ${code}`))))
  })
}

export function normalizeProvisionConfig(raw = {}) {
  return {
    provision: PROVISION_MODES.includes(raw?.provision) ? raw.provision : 'verified-download',
    downloadTimeoutMs: Number.isInteger(raw?.downloadTimeoutMs) ? raw.downloadTimeoutMs : 300_000,
    installDir: typeof raw?.installDir === 'string' && raw.installDir ? raw.installDir : '',
  }
}

export function createTunnelProvisioner({
  config = {},
  stateDir,
  log = console,
  platform = process.platform,
  arch = process.arch,
  manifest = TUNNEL_MANIFEST,
  download = defaultDownload,
  now = () => Date.now(),
  exists = existsSync,
} = {}) {
  const settings = normalizeProvisionConfig(config)
  const root = settings.installDir || path.join(stateDir, 'bin')
  const binaryName = platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'
  const binaryPath = path.join(root, binaryName)
  const provenancePath = path.join(root, 'cloudflared.provenance.json')

  function installedInfo() {
    try {
      if (!exists(binaryPath) || !exists(provenancePath)) return undefined
      const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'))
      if (!provenance || provenance.version !== manifest.version) return undefined
      return provenance
    } catch {
      return undefined
    }
  }

  function plan() {
    const asset = assetFor(platform, arch, manifest)
    const installed = installedInfo()
    return {
      mode: settings.provision,
      version: manifest.version,
      source: 'https://github.com/cloudflare/cloudflared',
      asset: asset ? { name: asset.name, url: asset.url, sha256: asset.sha256, archive: asset.archive ?? null } : null,
      binaryPath: installed ? binaryPath : '',
      installed: Boolean(installed),
      guide: installGuide(platform),
    }
  }

  async function install({ consent = false } = {}) {
    if (settings.provision === 'manual') return { ok: false, error: 'provision-manual', plan: plan() }
    if (consent !== true) return { ok: false, error: 'consent-required', plan: plan() }
    const asset = assetFor(platform, arch, manifest)
    if (!asset) return { ok: false, error: 'platform-unsupported', plan: plan() }
    const existing = installedInfo()
    if (existing) return { ok: true, alreadyInstalled: true, binaryPath, version: manifest.version, provenance: existing }

    await mkdir(root, { recursive: true })
    const stamp = `${now()}-${Math.random().toString(16).slice(2, 8)}`
    const tempDownload = path.join(root, `.download-${stamp}-${asset.name}`)
    const tempWork = path.join(root, `.work-${stamp}`)
    try {
      log.info?.(`[remote-control] downloading cloudflared ${manifest.version} (${asset.name})`)
      await download(asset.url, tempDownload, settings.downloadTimeoutMs)
      const actual = await sha256File(tempDownload)
      if (actual !== asset.sha256) {
        await rm(tempDownload, { force: true })
        log.warn?.(`[remote-control] cloudflared checksum mismatch: ${actual} != ${asset.sha256}`)
        return { ok: false, error: 'checksum-mismatch', expected: asset.sha256, actual, plan: plan() }
      }
      let produced = tempDownload
      if (asset.archive === 'tgz') {
        await mkdir(tempWork, { recursive: true })
        await extractTgz(tempDownload, tempWork)
        const candidate = path.join(tempWork, 'cloudflared')
        if (!exists(candidate)) throw new Error('archive does not contain cloudflared')
        produced = candidate
      }
      await rename(produced, binaryPath)
      if (platform !== 'win32') await chmod(binaryPath, 0o755)
      const provenance = {
        version: manifest.version,
        url: asset.url,
        sha256: asset.sha256,
        installedAt: new Date(now()).toISOString(),
        platform,
        arch,
      }
      await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`)
      log.info?.(`[remote-control] cloudflared ${manifest.version} installed at ${binaryPath}`)
      return { ok: true, binaryPath, version: manifest.version, provenance }
    } catch (error) {
      await rm(tempDownload, { force: true }).catch(() => {})
      return { ok: false, error: 'install-failed', message: String(error?.message || error), plan: plan() }
    } finally {
      await rm(tempWork, { recursive: true, force: true }).catch(() => {})
      await rm(tempDownload, { force: true }).catch(() => {})
    }
  }

  return {
    plan,
    install,
    binaryPath: () => installedInfo() ? binaryPath : '',
    provenance: installedInfo,
  }
}

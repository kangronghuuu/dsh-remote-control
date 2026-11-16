import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Device identity: one Ed25519 signing key and one X25519 key-agreement key per
 * install, generated once and persisted owner-only.
 *
 * The Ed25519 key is the device's long-term identity: its fingerprint goes into
 * invites and approval records, and peer calls are signed with it. The X25519
 * key is reserved for the encrypted channel (phase A2); it is stored now so a
 * device never has to rotate identity to gain encryption.
 *
 * The short authentication string (SAS) binds two fingerprints and the invite
 * nonce, so both screens show the same six digits only when both devices hold
 * the keys they claim.
 */

export function fingerprintOf(publicKeyPem) {
  const key = createPublicKey(publicKeyPem)
  const der = key.export({ type: 'spki', format: 'der' })
  return createHash('sha256').update(der).digest('hex').slice(0, 32)
}

export function sasCode(fingerprintA, fingerprintB, nonce) {
  const ordered = [fingerprintA, fingerprintB].sort().join(':')
  const digest = createHash('sha256').update(`${ordered}:${nonce}`).digest()
  const value = digest.readUInt32BE(0) % 1_000_000
  return String(value).padStart(6, '0')
}

export function signPayload(privateKey, payload) {
  return sign(null, Buffer.from(payload), privateKey).toString('base64url')
}

export function verifyPayload(publicKeyPem, payload, signature) {
  try {
    return verify(null, Buffer.from(payload), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64url'))
  } catch {
    return false
  }
}

export async function loadOrCreateIdentity(file, log = console, store) {
  let stored
  if (store) {
    try {
      stored = await store.load()
    } catch (error) {
      log.warn?.(`[remote-control] could not read the identity record: ${error?.message || error}`)
    }
  }
  if (!stored) {
    try {
      stored = JSON.parse(await readFile(file, 'utf8'))
    } catch (error) {
      if (error?.code !== 'ENOENT') log.warn?.(`[remote-control] could not read identity: ${error?.message || error}`)
    }
  }

  if (stored?.ed25519?.privateKey && stored?.ed25519?.publicKey) {
    try {
      const ed25519 = {
        publicKey: createPublicKey(stored.ed25519.publicKey),
        privateKey: createPrivateKey(stored.ed25519.privateKey),
        publicKeyPem: stored.ed25519.publicKey,
      }
      let x25519 = null
      if (stored?.x25519?.privateKey) {
        x25519 = {
          publicKey: createPublicKey(stored.x25519.publicKey),
          privateKey: createPrivateKey(stored.x25519.privateKey),
          publicKeyPem: stored.x25519.publicKey,
        }
      }
      return { ed25519, x25519, fingerprint: fingerprintOf(ed25519.publicKeyPem), createdAt: stored.createdAt ?? Date.now(), fresh: false }
    } catch {
      log.warn?.('[remote-control] stored identity is unusable; generating a new one')
    }
  }

  const ed = generateKeyPairSync('ed25519')
  const x = generateKeyPairSync('x25519')
  const record = {
    createdAt: Date.now(),
    ed25519: {
      publicKey: ed.publicKey.export({ type: 'spki', format: 'pem' }),
      privateKey: ed.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    },
    x25519: {
      publicKey: x.publicKey.export({ type: 'spki', format: 'pem' }),
      privateKey: x.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    },
  }
  try {
    if (store) {
      await store.save(record)
    } else {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, JSON.stringify(record, null, 2), { mode: 0o600 })
    }
  } catch (error) {
    log.warn?.(`[remote-control] could not persist identity: ${error?.message || error}`)
  }
  return {
    ed25519: { publicKey: ed.publicKey, privateKey: ed.privateKey, publicKeyPem: record.ed25519.publicKey },
    x25519: { publicKey: x.publicKey, privateKey: x.privateKey, publicKeyPem: record.x25519.publicKey },
    fingerprint: fingerprintOf(record.ed25519.publicKey),
    createdAt: record.createdAt,
    fresh: true,
  }
}

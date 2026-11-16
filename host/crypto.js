import { createCipheriv, createDecipheriv, createPublicKey, diffieHellman, generateKeyPairSync, getCiphers, hkdfSync, randomBytes } from 'node:crypto'

/**
 * Random-nonce AEAD for unreliable transports: a duplicated or reordered
 * datagram is harmless because each packet carries its own nonce, and plaintext
 * replay is stopped at the request layer by the signed timestamp + nonce.
 */
export function createBoxCipher(key) {
  const TAG = 16
  return {
    seal(plaintext) {
      const nonce = randomBytes(12)
      const cipherId = preferredCipherId()
      nonce[1] = cipherId
      const cipher = createCipheriv(algorithmOf(cipherId), key, nonce, { authTagLength: TAG })
      const body = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()])
      return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString('base64')
    },
    open(packet) {
      const raw = Buffer.from(String(packet), 'base64')
      if (raw.length < 12 + TAG) throw new Error('box: short packet')
      const nonce = raw.subarray(0, 12)
      const tag = raw.subarray(raw.length - TAG)
      const body = raw.subarray(12, raw.length - TAG)
      const decipher = createDecipheriv(algorithmOf(nonce[1] || CIPHER_CHACHA), key, nonce, { authTagLength: TAG })
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(body), decipher.final()])
    },
  }
}

/**
 * Peer channel crypto (phase A2).
 *
 * Static-static X25519 agreement per device pair, HKDF-SHA256 to a 32-byte
 * session key, then ChaCha20-Poly1305 with a per-direction counter nonce:
 *
 *   nonce = 1 byte direction | 11 byte big-endian counter
 *
 * The receiver demands the exact next nonce, so a replayed, reordered or
 * forked packet fails authentication instead of decrypting. AAD is empty
 * because the nonce already binds direction and position; the ciphertext is
 * authenticated over its full length.
 *
 * Known limitation: static keys give no forward secrecy. Replacing this with a
 * Noise-IK-style ephemeral handshake is the next step; the wire format already
 * carries a version tag so both can coexist.
 */

export const CHANNEL_VERSION = 1

/**
 * Peer wire version. Peers announce it in `/peer/hello`; a peer that speaks a
 * different version is refused with `version-mismatch` instead of failing later
 * with an undecryptable envelope, which is indistinguishable from a bad key.
 */
export const WIRE_VERSION = 1

/**
 * Cipher ids live in the free second nonce byte, so the receiver can pick the
 * algorithm the sender actually used. That keeps 0.4.x peers interoperable when
 * one runtime lacks ChaCha20-Poly1305 (e.g. a BoringSSL build): the sender falls
 * back to AES-256-GCM and the receiver reads the id instead of guessing.
 */
const CIPHER_CHACHA = 1
const CIPHER_AES = 2
let preferredCipher

function availableCiphers() {
  try { return new Set(getCiphers()) } catch { return new Set() }
}

export function preferredCipherName() {
  return preferredCipherId() === CIPHER_AES ? 'aes-256-gcm' : 'chacha20-poly1305'
}

function preferredCipherId() {
  if (preferredCipher) return preferredCipher
  const forced = process.env?.DSH_RC_CIPHER === 'aes-256-gcm' ? CIPHER_AES : (process.env?.DSH_RC_CIPHER === 'chacha20-poly1305' ? CIPHER_CHACHA : undefined)
  if (forced) { preferredCipher = forced; return preferredCipher }
  const list = availableCiphers()
  preferredCipher = list.has('chacha20-poly1305')
    ? CIPHER_CHACHA
    : (list.has('aes-256-gcm') ? CIPHER_AES : CIPHER_CHACHA)
  return preferredCipher
}

export function supportedCiphers() {
  const list = availableCiphers()
  const out = []
  if (list.has('chacha20-poly1305')) out.push('chacha20-poly1305')
  if (list.has('aes-256-gcm')) out.push('aes-256-gcm')
  return out
}

function algorithmOf(id) {
  return id === CIPHER_AES ? 'aes-256-gcm' : 'chacha20-poly1305'
}

/**
 * Ephemeral key agreement for forward secrecy.
 *
 * The session key mixes one ephemeral DH (fresh per pairing) with one static DH
 * that authenticates the peer's long-term key. The ephemeral private key is
 * dropped when the pairing context is disposed, so a later compromise of the
 * long-term keys cannot reconstruct past session keys.
 *
 * This is IK-shaped but NOT a Noise implementation: no protocol name hash, no
 * handshake transcript beyond the fingerprint salt. Do not describe it as Noise.
 */
export function generateEphemeralKeypair() {
  return generateKeyPairSync('x25519')
}

export function ephemeralPublicPem(pair) {
  return pair.publicKey.export({ type: 'spki', format: 'pem' })
}

export function deriveEphemeralKey({
  ephemeralPrivate,
  peerEphemeralPublicPem,
  staticPrivate,
  peerStaticPublicPem,
  myFingerprint,
  peerFingerprint,
  label = 'channel',
}) {
  const ephemeralShared = diffieHellman({
    privateKey: ephemeralPrivate,
    publicKey: createPublicKey(peerEphemeralPublicPem),
  })
  const staticShared = diffieHellman({
    privateKey: staticPrivate,
    publicKey: createPublicKey(peerStaticPublicPem),
  })
  const salt = Buffer.from([myFingerprint, peerFingerprint].sort().join(':'), 'utf8')
  const info = Buffer.from(`dsh-remote-control/${label}-fs/v${CHANNEL_VERSION}`, 'utf8')
  return Buffer.from(hkdfSync('sha256', Buffer.concat([ephemeralShared, staticShared]), salt, info, 32))
}

export function deriveSessionKey({ privateKey, peerPublicKeyPem, myFingerprint, peerFingerprint, label = 'channel' }) {
  const peerPublicKey = createPublicKey(peerPublicKeyPem)
  const shared = diffieHellman({ privateKey, publicKey: peerPublicKey })
  const salt = Buffer.from([myFingerprint, peerFingerprint].sort().join(':'), 'utf8')
  const info = Buffer.from(`dsh-remote-control/${label}/v${CHANNEL_VERSION}`, 'utf8')
  return Buffer.from(hkdfSync('sha256', shared, salt, info, 32))
}

function nonceFor(direction, counter) {
  const nonce = Buffer.alloc(12)
  nonce[0] = direction
  nonce.writeBigUInt64BE(BigInt(counter), 4)
  return nonce
}

/**
 * One direction-aware AEAD pair for a peer session. `side` fixes which
 * direction byte this endpoint sends with, so both peers agree without
 * negotiating it on the wire.
 */
export function createCipherPair(key, side, forcedCipher) {
  const sendDirection = side === 'a' ? 1 : 2
  const receiveDirection = side === 'a' ? 2 : 1
  let sendCounter = 0
  let lastReceived = -1
  const received = new Set() // counters inside the replay window
  const WINDOW = 512

  return {
    seal(plaintext) {
      const nonce = nonceFor(sendDirection, sendCounter)
      const cipherId = forcedCipher ?? preferredCipherId()
      nonce[1] = cipherId
      const cipher = createCipheriv(algorithmOf(cipherId), key, nonce, { authTagLength: 16 })
      const body = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()])
      sendCounter += 1
      return Buffer.concat([nonce, cipher.getAuthTag(), body]).toString('base64')
    },
    open(packet) {
      const raw = Buffer.from(String(packet), 'base64')
      if (raw.length < 28) throw new Error('channel: short packet')
      const nonce = raw.subarray(0, 12)
      if (nonce[0] !== receiveDirection) throw new Error('channel: wrong direction')
      const counter = Number(nonce.readBigUInt64BE(4))
      // Sliding window: concurrent sends can arrive in a different order than
      // their counters (one HTTP POST per message, no ordering guarantee), so a
      // strictly increasing rule would drop valid traffic. Old or duplicated
      // counters are still refused.
      if (counter <= lastReceived - WINDOW) throw new Error('channel: replay')
      if (received.has(counter)) throw new Error('channel: replay')
      const tag = raw.subarray(12, 28)
      const body = raw.subarray(28)
      const decipher = createDecipheriv(algorithmOf(nonce[1] || CIPHER_CHACHA), key, nonce, { authTagLength: 16 })
      decipher.setAuthTag(tag)
      const plain = Buffer.concat([decipher.update(body), decipher.final()])
      received.add(counter)
      if (counter > lastReceived) {
        lastReceived = counter
        for (const seen of received) {
          if (seen <= lastReceived - WINDOW) received.delete(seen)
        }
      }
      return plain
    },
    stats: () => ({ sent: sendCounter, received: lastReceived >= 0 ? lastReceived + 1 : 0 }),
    reset() { sendCounter = 0; lastReceived = -1n },
  }
}

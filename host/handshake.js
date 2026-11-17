import { signPayload, verifyPayload } from './identity.js'

/**
 * Pairing handshake messages for forward secrecy.
 *
 * Each side mints a fresh X25519 ephemeral key for one pairing attempt and
 * signs the public half together with the device id and the invite nonce:
 *
 *   payload = `${deviceId}\n${pairCode}\n${ephemeralPublicPem}`
 *
 * The signature proves the ephemeral belongs to the identity that was approved,
 * so a relay cannot substitute its own ephemeral key. The private half never
 * leaves the process and is dropped once both lanes are derived.
 *
 * This is a message format, not a protocol: ordering and retry live in hello.
 */

export function ephemeralPayload(deviceId, pairCode, publicPem) {
  return `${deviceId}\n${pairCode}\n${publicPem}`
}

export function mintEphemeral(identity, deviceId, pairCode, keypair) {
  const publicPem = keypair.publicKey.export({ type: 'spki', format: 'pem' })
  return {
    publicPem,
    // The signer's own nonce travels with the proof: a verifier cannot know it
    // in advance (it is per-Host and rotates), and using its own made every
    // post-restart rehandshake fail with bad-handshake.
    pairCode: String(pairCode ?? ''),
    signature: signPayload(identity.ed25519.privateKey, ephemeralPayload(deviceId, pairCode, publicPem)),
  }
}

export function verifyEphemeral(identityPublicKeyPem, deviceId, pairCode, message) {
  if (!identityPublicKeyPem || !message || typeof message.publicPem !== 'string' || typeof message.signature !== 'string') {
    return false
  }
  // Prefer the nonce carried (and signed) by the sender; fall back to the
  // caller-supplied one for messages minted by an older version.
  const nonce = typeof message.pairCode === 'string' ? message.pairCode : pairCode
  return verifyPayload(
    identityPublicKeyPem,
    ephemeralPayload(deviceId, nonce, message.publicPem),
    message.signature,
  )
}

import dgram from 'node:dgram'
import { randomBytes } from 'node:crypto'

/**
 * UDP hole-punch exchange (Phase B).
 *
 * Both sides send a small HELLO packet to each of the peer's advertised
 * candidates on an interval; the first packet to arrive proves the NAT mapping
 * and the socket becomes the direct lane. Retries continue until the timeout
 * because the two sides' first sends rarely cross.
 *
 * This is the exchange only. On a network without NAT the same code path runs
 * between two bound sockets, which is exactly how scripts/punch-test.mjs
 * verifies it; on two real NATs it still needs a live trial.
 */

const MAGIC = Buffer.from('DSHPUNCH1', 'utf8')

export async function createPuncher({ intervalMs = 200, bindPort = 0 } = {}) {
  const socket = dgram.createSocket('udp4')
  let settled
  let timer
  let resolveDone
  const done = new Promise((resolve) => { resolveDone = resolve })

  function finish(value) {
    if (settled) return
    settled = value
    clearInterval(timer)
    try { socket.close() } catch { /* already closed */ }
    resolveDone(value)
  }

  socket.on('message', (message, rinfo) => {
    if (message.length >= MAGIC.length && message.subarray(0, MAGIC.length).equals(MAGIC)) {
      finish({ ok: true, address: rinfo.address, port: rinfo.port })
    }
  })
  socket.on('error', (error) => finish({ ok: false, error: error?.message || 'socket-error' }))

  await new Promise((resolve, reject) => {
    socket.once('error', reject)
    socket.bind(bindPort, resolve)
  })
  const port = socket.address().port

  function start(candidates, timeoutMs = 3000) {
    if (settled) return Promise.resolve(settled)
    const targets = (candidates ?? []).filter((entry) => entry && entry.address && entry.port)
    const packet = Buffer.concat([MAGIC, randomBytes(4)])
    const send = () => {
      for (const target of targets) {
        try { socket.send(packet, 0, packet.length, target.port, target.address) } catch { /* candidate unreachable */ }
      }
    }
    send()
    timer = setInterval(send, intervalMs)
    timer.unref?.()
    const deadline = setTimeout(() => finish({ ok: false, error: 'timeout' }), timeoutMs)
    deadline.unref?.()
    return done
  }

  return {
    port: () => port,
    start,
    close: () => finish({ ok: false, error: 'closed' }),
  }
}

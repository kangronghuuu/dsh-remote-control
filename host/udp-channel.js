import dgram from 'node:dgram'
import { randomBytes } from 'node:crypto'
import { buildBindingRequest, parseBindingResponse } from './nat.js'

/**
 * Minimal reliable datagram channel over UDP, for the punched P2P lane.
 *
 * A message is JSON, split into 1200-byte fragments. Each fragment carries
 * (type, messageId, seq, total); the sender retransmits the whole message on an
 * interval until the receiver acknowledges it, and the receiver reassembles
 * fragments and delivers only complete messages. Responses reference the
 * request's message id via `replyTo`, so a caller can correlate them without a
 * connection.
 *
 * This is a handshake-free, single-peer-ish channel: it is deliberately small
 * and is not a general transport. Ordering across concurrent messages is not
 * guaranteed; callers that need it must serialize.
 */

const MAGIC = Buffer.from('DSHUDP01', 'utf8')
const TYPE_DATA = 0
const TYPE_ACK = 1
const HEADER = 8 + 1 + 4 + 2 + 2
const MAX_PAYLOAD = 1200

function pack(type, messageId, seq, total, payload) {
  const buffer = Buffer.alloc(HEADER + payload.length)
  MAGIC.copy(buffer, 0)
  buffer.writeUInt8(type, 8)
  buffer.writeUInt32BE(messageId >>> 0, 9)
  buffer.writeUInt16BE(seq, 13)
  buffer.writeUInt16BE(total, 15)
  payload.copy(buffer, HEADER)
  return buffer
}

function unpack(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < HEADER) return undefined
  if (!buffer.subarray(0, MAGIC.length).equals(MAGIC)) return undefined
  return {
    type: buffer.readUInt8(8),
    messageId: buffer.readUInt32BE(9),
    seq: buffer.readUInt16BE(13),
    total: buffer.readUInt16BE(15),
    payload: buffer.subarray(HEADER),
  }
}

export async function createUdpChannel({ handler, intervalMs = 300, timeoutMs = 5000, bindPort = 0 } = {}) {
  const socket = dgram.createSocket('udp4')
  await new Promise((resolve, reject) => {
    socket.once('error', reject)
    socket.bind(bindPort, resolve)
  })
  const port = socket.address().port
  let nextId = 0
  const deliveries = new Map() // messageId -> resolve(ok) on ack
  const responses = new Map() // requestId -> resolve(message)
  const inbound = new Map() // key -> { parts, total, remote }

  function transmit(remote, message) {
    const messageId = nextId++
    const text = Buffer.from(JSON.stringify(message), 'utf8')
    const total = Math.max(1, Math.ceil(text.length / MAX_PAYLOAD))
    const chunks = []
    for (let index = 0; index < total; index += 1) {
      chunks.push(text.subarray(index * MAX_PAYLOAD, (index + 1) * MAX_PAYLOAD))
    }
    const send = () => {
      chunks.forEach((chunk, seq) => {
        try { socket.send(pack(TYPE_DATA, messageId, seq, total, chunk), remote.port, remote.address) } catch { /* unreachable */ }
      })
    }
    send()
    const timer = setInterval(send, intervalMs)
    timer.unref?.()
    return new Promise((resolve) => {
      const deadline = setTimeout(() => { clearInterval(timer); deliveries.delete(messageId); resolve(false) }, timeoutMs)
      deliveries.set(messageId, () => { clearInterval(timer); clearTimeout(deadline); deliveries.delete(messageId); resolve(true) })
    })
  }

  async function request(remote, message) {
    const responsePromise = new Promise((resolve) => {
      const requestId = nextId
      responses.set(requestId, resolve)
      setTimeout(() => {
        if (!responses.has(requestId)) return
        responses.delete(requestId)
        resolve(undefined)
      }, timeoutMs).unref?.()
    })
    const delivered = await transmit(remote, message)
    if (!delivered) return { ok: false, error: 'timeout' }
    const reply = await responsePromise
    if (!reply) return { ok: false, error: 'no-reply' }
    return { ok: true, message: reply }
  }

  /** Fire-and-forget datagram; used for streaming frames where a reply is wrong. */
  function notify(remote, message) {
    const messageId = nextId++
    const text = Buffer.from(JSON.stringify(message), 'utf8')
    const total = Math.max(1, Math.ceil(text.length / MAX_PAYLOAD))
    for (let seq = 0; seq < total; seq += 1) {
      const chunk = text.subarray(seq * MAX_PAYLOAD, (seq + 1) * MAX_PAYLOAD)
      try { socket.send(pack(TYPE_DATA, messageId, seq, total, chunk), remote.port, remote.address) } catch { /* unreachable */ }
    }
  }

  socket.on('message', async (buffer, rinfo) => {
    const frame = unpack(buffer)
    if (!frame) return
    if (frame.type === TYPE_ACK) {
      deliveries.get(frame.messageId)?.()
      return
    }
    if (frame.type !== TYPE_DATA) return
    const key = `${frame.messageId}:${rinfo.address}:${rinfo.port}`
    let entry = inbound.get(key)
    if (!entry) {
      entry = { parts: new Array(frame.total), total: frame.total, remote: rinfo }
      inbound.set(key, entry)
    }
    entry.parts[frame.seq] = frame.payload
    if (entry.parts.filter(Boolean).length < entry.total) return
    inbound.delete(key)
    const message = JSON.parse(Buffer.concat(entry.parts).toString('utf8'))
    try { socket.send(pack(TYPE_ACK, frame.messageId, 0, 0, Buffer.alloc(0)), rinfo.port, rinfo.address) } catch { /* ignore */ }
    if (typeof message.replyTo === 'number') {
      const resolve = responses.get(message.replyTo)
      if (resolve) { responses.delete(message.replyTo); resolve(message) }
      return
    }
    if (typeof handler !== 'function') return
    try {
      const reply = await handler(message, rinfo)
      transmit(rinfo, { ...(reply ?? {}), replyTo: frame.messageId })
    } catch { /* handler failure drops the request */ }
  })

  /** Discover this socket's public mapping with STUN, from this very socket. */
  function stun({ host = 'stun.l.google.com', port = 19302, timeoutMs = 1500 } = {}) {
    return new Promise((resolve) => {
      const transactionId = randomBytes(12)
      const request = buildBindingRequest(transactionId)
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        socket.removeListener('message', onMessage)
        clearTimeout(timer)
        resolve(value)
      }
      const onMessage = (buffer) => {
        if (buffer.length >= 20 && buffer.readUInt32BE(4) === 0x2112a442 && buffer.subarray(8, 20).equals(transactionId)) {
          finish(parseBindingResponse(buffer))
        }
      }
      socket.on('message', onMessage)
      const timer = setTimeout(() => finish(undefined), timeoutMs)
      timer.unref?.()
      try { socket.send(request, 0, request.length, port, host) } catch { finish(undefined) }
    })
  }

  return {
    port,
    request,
    notify,
    stun,
    close: () => new Promise((resolve) => { try { socket.close(resolve) } catch { resolve() } }),
  }
}

export { pack, unpack, TYPE_DATA, TYPE_ACK }

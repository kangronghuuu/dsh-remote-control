import http from 'node:http'
import { createBoxCipher } from './crypto.js'
import { createUdpChannel } from './udp-channel.js'

/**
 * P2P proxy for the punched lane: carries HTTP-shaped peer calls and SSE frames
 * over the UDP channel between two DSH instances and replays them into the
 * local listener, so authentication, sealing and scope checks stay in one place.
 *
 * Unary calls use request/response (ACKed). Stream frames are one-way datagrams:
 * a lost frame is acceptable because the transcript resynchronizes from the next
 * snapshot, and retransmitting ordered frames over an unreliable transport would
 * need a much larger protocol than this lane is worth.
 */

export async function createP2pNode({ localPort, bindPort = 0, keyFor, selfDeviceId, log = console }) {
  const streams = new Map() // streamId -> { onChunk, onEnd }
  let nextStreamId = 1

  function forward(inner) {
    return new Promise((resolve) => {
      const text = typeof inner?.bodyText === 'string' ? inner.bodyText : ''
      const request = http.request({
        host: '127.0.0.1',
        port: localPort,
        path: typeof inner?.path === 'string' ? inner.path : '/',
        method: inner?.method || 'GET',
        headers: {
          ...(inner?.headers ?? {}),
          host: `127.0.0.1:${localPort}`,
          'x-dsh-via': 'p2p',
          'content-length': Buffer.byteLength(text),
        },
        timeout: 10000,
      }, (response) => {
        let data = ''
        response.on('data', (chunk) => { data += chunk })
        response.on('end', () => resolve({ status: response.statusCode ?? 502, bodyText: data }))
      })
      request.on('timeout', () => request.destroy(new Error('timeout')))
      request.on('error', () => resolve({ status: 502, bodyText: '' }))
      request.end(text || undefined)
    })
  }

  /** Forward one SSE stream to a peer as datagrams. */
  function relayStream(remote, box, inner, streamId) {
    const request = http.request({
      host: '127.0.0.1',
      port: localPort,
      path: typeof inner?.path === 'string' ? inner.path : '/',
      method: 'GET',
      headers: {
        ...(inner?.headers ?? {}),
        host: `127.0.0.1:${localPort}`,
        'x-dsh-via': 'p2p',
        accept: 'text/event-stream',
      },
      timeout: 15000,
    }, (response) => {
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        channel.notify(remote, { from: selfDeviceId, box: box.seal(JSON.stringify({ streamChunk: streamId, chunk })) })
      })
      response.on('end', () => {
        channel.notify(remote, { from: selfDeviceId, box: box.seal(JSON.stringify({ streamEnd: streamId })) })
      })
    })
    request.on('timeout', () => request.destroy(new Error('timeout')))
    request.on('error', () => { /* the peer sees the stream stall and retries */ })
    request.end()
  }

  async function handleDatagram(message, rinfo) {
    // The punch probe is authenticated too: an open responder would answer any
    // datagram and hand out a reflection surface.
    if (typeof message?.box !== 'string') return { error: 'bad-envelope' }
    const deviceId = String(message.from || '')
    const box = keyFor(deviceId)
    if (!box || typeof box.open !== 'function') return { error: 'no-channel' }
    let inner
    try {
      inner = JSON.parse(box.open(message.box).toString('utf8'))
    } catch {
      return { error: 'bad-envelope' }
    }

    if (inner?.punch === true) return { box: box.seal(JSON.stringify({ pong: true })) }

    if (inner?.streamOpen) {
      relayStream(rinfo, box, inner.streamOpen, inner.streamId)
      return { ok: true }
    }
    if (typeof inner?.streamChunk === 'number') {
      streams.get(inner.streamChunk)?.onChunk?.(String(inner.chunk ?? ''))
      return { ok: true }
    }
    if (typeof inner?.streamEnd === 'number') {
      const entry = streams.get(inner.streamEnd)
      streams.delete(inner.streamEnd)
      entry?.onEnd?.()
      return { ok: true }
    }

    const result = await forward(inner)
    return { box: box.seal(JSON.stringify(result)) }
  }

  const channel = await createUdpChannel({ bindPort, handler: handleDatagram })

  async function request(remote, deviceId, inner) {
    const box = keyFor(deviceId)
    if (!box) return { ok: false, error: 'no-channel' }
    const result = await channel.request(remote, { from: selfDeviceId, box: box.seal(JSON.stringify(inner)) })
    if (!result.ok) return result
    const reply = result.message
    if (typeof reply?.box !== 'string') return { ok: false, error: reply?.error || 'bad-reply' }
    try {
      return { ok: true, message: JSON.parse(box.open(reply.box).toString('utf8')) }
    } catch {
      return { ok: false, error: 'bad-reply' }
    }
  }

  function openStream(remote, deviceId, inner, handlers = {}) {
    const box = keyFor(deviceId)
    if (!box) return { ok: false, error: 'no-channel' }
    const streamId = nextStreamId++
    streams.set(streamId, handlers)
    channel.notify(remote, {
      from: selfDeviceId,
      box: box.seal(JSON.stringify({ streamOpen: inner, streamId })),
    })
    return {
      ok: true,
      streamId,
      close: () => {
        streams.delete(streamId)
        const current = keyFor(deviceId)
        if (current) {
          channel.notify(remote, { from: selfDeviceId, box: current.seal(JSON.stringify({ streamEnd: streamId })) })
        }
      },
    }
  }

  return {
    port: channel.port,
    request,
    openStream,
    mapped: (options) => channel.stun(options),
    async punch(remote, deviceId) {
      const box = keyFor(deviceId)
      if (!box) return { ok: false, error: 'no-channel' }
      const result = await channel.request(remote, { from: selfDeviceId, box: box.seal(JSON.stringify({ punch: true })) })
      if (!result.ok) return { ok: false, error: result.error || 'no-pong' }
      if (typeof result.message?.box !== 'string') return { ok: false, error: result.message?.error || 'no-pong' }
      try {
        const reply = JSON.parse(box.open(result.message.box).toString('utf8'))
        return reply?.pong === true ? { ok: true } : { ok: false, error: 'no-pong' }
      } catch {
        return { ok: false, error: 'bad-reply' }
      }
    },
    close: () => channel.close(),
  }
}

export { createBoxCipher }

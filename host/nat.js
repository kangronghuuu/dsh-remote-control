import dgram from 'node:dgram'
import { randomBytes } from 'node:crypto'
import os from 'node:os'

/**
 * Phase B building blocks: IPv6-first candidate discovery and a minimal STUN
 * binding client.
 *
 * Only this half is verifiable on the current network (which has no IPv6 and no
 * second NAT): the binding request/response codec and candidate filtering are
 * exercised against an in-process STUN responder. Hole punching itself needs
 * two real NATs and is not attempted here.
 */

const MAGIC = 0x2112a442
const BINDING_REQUEST = 0x0001
const BINDING_SUCCESS = 0x0101
const XOR_MAPPED_ADDRESS = 0x0020

export function buildBindingRequest(transactionId = randomBytes(12)) {
  const buffer = Buffer.alloc(20)
  buffer.writeUInt16BE(BINDING_REQUEST, 0)
  buffer.writeUInt16BE(0, 2)
  buffer.writeUInt32BE(MAGIC, 4)
  transactionId.copy(buffer, 8, 0, 12)
  return buffer
}

export function parseBindingResponse(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20) return undefined
  if (buffer.readUInt16BE(0) !== BINDING_SUCCESS) return undefined
  if (buffer.readUInt32BE(4) !== MAGIC) return undefined
  const length = buffer.readUInt16BE(2)
  if (20 + length > buffer.length) return undefined
  let offset = 20
  const end = 20 + length
  while (offset + 4 <= end) {
    const type = buffer.readUInt16BE(offset)
    const size = buffer.readUInt16BE(offset + 2)
    const valueStart = offset + 4
    if (valueStart + size > end) return undefined
    if (type === XOR_MAPPED_ADDRESS && size >= 8) {
      const family = buffer[valueStart + 1]
      const port = buffer.readUInt16BE(valueStart + 2) ^ (MAGIC >>> 16)
      if (family === 0x01) {
        const raw = buffer.readUInt32BE(valueStart + 4)
        const address = (raw ^ MAGIC) >>> 0
        return {
          family: 'IPv4',
          address: `${(address >>> 24) & 0xff}.${(address >>> 16) & 0xff}.${(address >>> 8) & 0xff}.${address & 0xff}`,
          port,
        }
      }
      if (family === 0x02 && size >= 20) {
        const raw = buffer.subarray(valueStart + 4, valueStart + 20)
        const mask = Buffer.alloc(16)
        mask.writeUInt32BE(MAGIC, 0)
        buffer.copy(mask, 4, 4, 20) // transaction id
        const address = Buffer.from(raw.map((byte, index) => byte ^ mask[index]))
        const groups = []
        for (let i = 0; i < 16; i += 2) groups.push(address.readUInt16BE(i).toString(16))
        return { family: 'IPv6', address: groups.join(':'), port }
      }
    }
    offset = valueStart + size + ((4 - (size % 4)) % 4)
  }
  return undefined
}

export function stunBinding({ host = 'stun.l.google.com', port = 19302, timeoutMs = 2000 } = {}) {
  return new Promise((resolve) => {
    const transactionId = randomBytes(12)
    const request = buildBindingRequest(transactionId)
    const socket = dgram.createSocket('udp4')
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { socket.close() } catch { /* ignore */ }
      resolve(value)
    }
    const timer = setTimeout(() => finish(undefined), timeoutMs)
    socket.on('error', () => finish(undefined))
    socket.on('message', (message) => {
      if (message.length >= 20 && message.readUInt32BE(4) === MAGIC && message.subarray(8, 20).equals(transactionId)) {
        finish(parseBindingResponse(message))
      }
    })
    socket.send(request, 0, request.length, port, host, (error) => {
      if (error) finish(undefined)
    })
  })
}

/** IPv6 candidates first, then IPv4; loopback and link-local are excluded. */
export function localCandidates(interfaces = os.networkInterfaces()) {
  const ipv6 = []
  const ipv4 = []
  for (const entries of Object.values(interfaces ?? {})) {
    for (const entry of entries ?? []) {
      if (!entry || entry.internal) continue
      if (entry.family === 'IPv6' || entry.family === 6) {
        if (entry.address.startsWith('fe80') || entry.address === '::1') continue
        ipv6.push({ family: 'IPv6', address: entry.address })
      } else if (entry.family === 'IPv4' || entry.family === 4) {
        if (entry.address.startsWith('127.')) continue
        ipv4.push({ family: 'IPv4', address: entry.address })
      }
    }
  }
  return [...ipv6, ...ipv4]
}

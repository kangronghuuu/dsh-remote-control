import { randomUUID } from 'node:crypto'

/**
 * Peer file uploads.
 *
 * A remote device never writes a path: it streams base64 chunks to this Host,
 * and `commit` stores the assembled bytes through the attachment service, the
 * same store the browser UI uses. State is per-upload, in memory, and bound to
 * one session; nothing survives a commit except the attachment itself.
 *
 * Chunk size stays below the relay's per-message limit: 1 MiB of bytes becomes
 * ~1.37 MiB of base64, comfortably inside the 2 MB message cap.
 */

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const DEFAULT_TYPES = [
  ...IMAGE_TYPES,
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/json',
  'application/zip',
  'application/octet-stream',
]

export function createUploadManager({ getAttachments, limits = {}, log = console } = {}) {
  const config = {
    maxFileBytes: limits.maxFileBytes ?? 25 * 1024 * 1024,
    chunkBytes: limits.chunkBytes ?? 1024 * 1024,
    sessionQuotaBytes: limits.sessionQuotaBytes ?? 100 * 1024 * 1024,
    ttlMs: limits.ttlMs ?? 10 * 60 * 1000,
    allowedTypes: new Set(limits.allowedTypes ?? DEFAULT_TYPES),
    reaperMs: limits.reaperMs ?? 60_000,
  }

  const uploads = new Map()
  const usage = new Map() // sessionId -> committed bytes

  const reaper = setInterval(() => {
    const now = Date.now()
    for (const [uploadId, upload] of uploads) {
      if (now - upload.at > config.ttlMs) uploads.delete(uploadId)
    }
  }, config.reaperMs)
  reaper.unref?.()

  const fail = (status, error, message) => ({ status, error, message })

  function sanitizeName(name) {
    const base = String(name ?? 'file').split(/[\\/]/).pop() || 'file'
    return base.replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim().slice(0, 120) || 'file'
  }

  function init(body) {
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
    if (!sessionId) return fail(400, 'missing-session', 'An upload must name its session.')
    const size = Number(body?.size)
    if (!Number.isInteger(size) || size <= 0) return fail(400, 'bad-size', 'size must be a positive integer.')
    if (size > config.maxFileBytes) {
      return fail(413, 'too-large', `Files are limited to ${Math.floor(config.maxFileBytes / (1024 * 1024))} MB.`)
    }
    const mediaType = typeof body?.mediaType === 'string' ? body.mediaType : 'application/octet-stream'
    if (!config.allowedTypes.has(mediaType)) return fail(415, 'bad-type', `Unsupported media type: ${mediaType}`)
    const used = usage.get(sessionId) ?? 0
    if (used + size > config.sessionQuotaBytes) {
      return fail(507, 'quota', 'This session has reached its upload quota.')
    }

    const uploadId = randomUUID()
    uploads.set(uploadId, {
      uploadId,
      sessionId,
      name: sanitizeName(body?.name),
      mediaType,
      size,
      chunkBytes: config.chunkBytes,
      chunks: new Map(),
      at: Date.now(),
    })
    return { status: 200, uploadId, chunkSize: config.chunkBytes, maxFileBytes: config.maxFileBytes }
  }

  function chunk(body) {
    const upload = uploads.get(String(body?.uploadId ?? ''))
    if (!upload) return fail(404, 'unknown-upload', 'This upload is unknown or expired.')
    const index = Number(body?.index)
    if (!Number.isInteger(index) || index < 0) return fail(400, 'bad-index', 'index must be a non-negative integer.')
    const encoded = typeof body?.data === 'string' ? body.data : ''
    if (!encoded) return fail(400, 'empty-chunk', 'Chunk data is required.')
    let bytes
    try {
      bytes = Buffer.from(encoded, 'base64')
    } catch {
      return fail(400, 'bad-encoding', 'Chunk data must be base64.')
    }
    if (bytes.length > upload.chunkBytes) return fail(413, 'chunk-too-large', 'Chunk exceeds the negotiated size.')

    const previous = upload.chunks.get(index)?.length ?? 0
    const total = [...upload.chunks.values()].reduce((sum, value) => sum + value.length, 0)
    if (total - previous + bytes.length > upload.size) {
      return fail(413, 'exceeds-declared', 'Chunks exceed the declared file size.')
    }

    upload.chunks.set(index, bytes)
    upload.at = Date.now()
    const receivedBytes = [...upload.chunks.values()].reduce((sum, value) => sum + value.length, 0)
    return { status: 200, received: upload.chunks.size, receivedBytes }
  }

  function status(body) {
    const upload = uploads.get(String(body?.uploadId ?? ''))
    if (!upload) return fail(404, 'unknown-upload', 'This upload is unknown or expired.')
    return {
      status: 200,
      uploadId: upload.uploadId,
      size: upload.size,
      chunkSize: upload.chunkBytes,
      received: [...upload.chunks.keys()].sort((a, b) => a - b),
      receivedBytes: [...upload.chunks.values()].reduce((sum, value) => sum + value.length, 0),
    }
  }

  async function commit(body) {
    const upload = uploads.get(String(body?.uploadId ?? ''))
    if (!upload) return fail(404, 'unknown-upload', 'This upload is unknown or expired.')
    const receivedBytes = [...upload.chunks.values()].reduce((sum, value) => sum + value.length, 0)
    if (receivedBytes !== upload.size) {
      return { ...fail(409, 'incomplete', 'Not every chunk arrived.'), receivedBytes, size: upload.size }
    }
    const attachments = getAttachments?.()
    if (!attachments) return fail(503, 'attachments-unavailable', 'This Host has no attachment store.')

    const data = Buffer.concat([...upload.chunks.keys()].sort((a, b) => a - b).map((index) => upload.chunks.get(index)))
    let attachment
    let kind
    try {
      if (IMAGE_TYPES.has(upload.mediaType)) {
        attachment = await attachments.saveImage({ data, mediaType: upload.mediaType, name: upload.name })
        kind = 'image'
      } else {
        attachment = await attachments.saveFile({ data, name: upload.name })
        kind = 'file'
      }
    } catch (error) {
      log.warn?.(`[remote-control] upload commit failed: ${error?.message || error}`)
      return fail(422, 'store-rejected', `The attachment store refused the file: ${error?.message || error}`)
    }

    uploads.delete(upload.uploadId)
    usage.set(upload.sessionId, (usage.get(upload.sessionId) ?? 0) + upload.size)
    return { status: 200, kind, attachment, sessionId: upload.sessionId, bytes: upload.size }
  }

  function cancel(body) {
    const uploadId = String(body?.uploadId ?? '')
    if (!uploads.has(uploadId)) return fail(404, 'unknown-upload', 'This upload is unknown or expired.')
    uploads.delete(uploadId)
    return { status: 200, ok: true }
  }

  return {
    init,
    chunk,
    status,
    commit,
    cancel,
    limits: config,
    stats: () => ({ uploads: uploads.size }),
    close: () => clearInterval(reaper),
  }
}

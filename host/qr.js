/**
 * Minimal QR encoder for invite payloads: byte mode, error correction level L,
 * versions 1-5 (up to 106 bytes), mask 0.
 *
 * Deliberately small: no micro-QR, no multi-block interleaving, no mask
 * selection heuristics. Enough for `http://host:port/ <key>#<code>`, and every
 * byte of it is verified by scripts/qr-test.mjs (round trip + RS syndromes).
 */

const DATA_CODEWORDS = [19, 34, 55, 80, 108]
const ECC_CODEWORDS = [7, 10, 15, 20, 26]

/* ---- GF(256) ---- */
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let value = 1
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = value
    LOG[value] = i
    value <<= 1
    if (value & 0x100) value ^= 0x11d
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255]
}

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0
  return EXP[LOG[a] + LOG[b]]
}

function rsGenerator(count) {
  // Descending coefficients: generator[0] is the leading (x^count) term, 1.
  let poly = [1]
  for (let i = 0; i < count; i += 1) {
    const root = EXP[i]
    const next = new Array(poly.length + 1).fill(0)
    for (let j = 0; j <= poly.length; j += 1) {
      let value = 0
      if (j < poly.length) value ^= poly[j]
      if (j > 0) value ^= gfMul(poly[j - 1], root)
      next[j] = value
    }
    poly = next
  }
  return poly
}

function rsEncode(data, eccCount) {
  const generator = rsGenerator(eccCount)
  const buffer = new Uint8Array(data.length + eccCount)
  buffer.set(data)
  // Long division: buffer starts as d(x) * x^ecc, subtract g(x) until the
  // leading coefficient is gone. The remainder is the ECC block.
  for (let i = 0; i < data.length; i += 1) {
    const factor = buffer[i]
    if (factor === 0) continue
    for (let j = 0; j < generator.length; j += 1) {
      buffer[i + j] ^= gfMul(generator[j], factor)
    }
  }
  return buffer.slice(data.length)
}

/* ---- bit stream ---- */
function buildCodewords(bytes) {
  let version = 1
  for (let index = 0; index < DATA_CODEWORDS.length; index += 1) {
    if (bytes.length <= DATA_CODEWORDS[index]) { version = index + 1; break }
    version = index + 1
  }
  const capacity = DATA_CODEWORDS[version - 1]
  if (bytes.length > capacity) throw new Error(`payload too long for QR v${version}`)

  const bits = []
  const push = (value, length) => { for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1) }
  push(0b0100, 4) // byte mode
  push(bytes.length, 8)
  for (const byte of bytes) push(byte, 8)
  const totalBits = capacity * 8
  push(0, Math.min(4, totalBits - bits.length)) // terminator
  while (bits.length % 8 !== 0) bits.push(0)
  const data = new Uint8Array(capacity)
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0
    for (let j = 0; j < 8; j += 1) value = (value << 1) | bits[i + j]
    data[i / 8] = value
  }
  const pads = [0xec, 0x11]
  for (let i = bits.length / 8, p = 0; i < capacity; i += 1, p += 1) data[i] = pads[p % 2]

  return { version, data, ecc: rsEncode(data, ECC_CODEWORDS[version - 1]) }
}

/* ---- matrix ---- */
export function encodeQr(text) {
  const bytes = Buffer.from(String(text), 'utf8')
  const { version, data, ecc } = buildCodewords(bytes)
  const size = 17 + version * 4
  const modules = Array.from({ length: size }, () => new Array(size).fill(false))
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false))

  const set = (row, col, dark) => { modules[row][col] = dark; reserved[row][col] = true }

  // finder patterns + separators
  for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const row = top + r
        const col = left + c
        if (row < 0 || col < 0 || row >= size || col >= size) continue
        const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6
        const border = r === 0 || r === 6 || c === 0 || c === 6
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4
        set(row, col, inside && (border || core))
      }
    }
  }

  // timing patterns
  for (let i = 8; i < size - 8; i += 1) {
    if (!reserved[6][i]) set(6, i, i % 2 === 0)
    if (!reserved[i][6]) set(i, 6, i % 2 === 0)
  }

  // alignment pattern (one per version 2-5)
  if (version >= 2) {
    const center = size - 7
    for (let r = -2; r <= 2; r += 1) {
      for (let c = -2; c <= 2; c += 1) {
        set(center + r, center + c, Math.max(Math.abs(r), Math.abs(c)) !== 1)
      }
    }
  }

  // format information: level L (01), mask 0
  const formatData = (1 << 3) | 0
  let remainder = formatData
  for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >> 9) * 0x537)
  const formatBits = ((formatData << 10) | remainder) ^ 0x5412
  for (let i = 0; i < 15; i += 1) {
    const dark = ((formatBits >> i) & 1) === 1
    if (i < 6) set(i, 8, dark)
    else if (i < 8) set(i + 1, 8, dark)
    else set(size - 15 + i, 8, dark)
    if (i < 8) set(8, size - i - 1, dark)
    else if (i === 8) set(8, 15 - i - 1 + 1, dark)
    else set(8, 15 - i - 1, dark)
  }
  set(size - 8, 8, true) // dark module

  // data placement, right-to-left zigzag, mask 0
  let byteIndex = 0
  let bitIndex = 7
  let row = size - 1
  let direction = -1
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1
    for (;;) {
      for (let c = 0; c < 2; c += 1) {
        const target = col - c
        if (reserved[row][target]) continue
        let dark = false
        if (byteIndex < data.length + ecc.length) {
          const block = byteIndex < data.length ? data : ecc
          const offset = byteIndex < data.length ? byteIndex : byteIndex - data.length
          dark = ((block[offset] >>> bitIndex) & 1) === 1
        }
        if ((row + target) % 2 === 0) dark = !dark
        modules[row][target] = dark
        bitIndex -= 1
        if (bitIndex === -1) { byteIndex += 1; bitIndex = 7 }
      }
      row += direction
      if (row < 0 || row >= size) { row -= direction; direction = -direction; break }
    }
  }

  return { version, size, modules, data, ecc, reserved }
}

/** Reed-Solomon syndromes of a full codeword block; all zero means valid. */
export function syndromesOf(codewords, eccCount) {
  const out = []
  for (let i = 0; i < eccCount; i += 1) {
    let value = 0
    for (const byte of codewords) value = gfMul(value, EXP[i]) ^ byte
    out.push(value)
  }
  return out
}

export { DATA_CODEWORDS, ECC_CODEWORDS, rsEncode }

/** Render an invite string as a standalone SVG (no external service). */
export function qrSvg(text, moduleSize = 4, margin = 4) {
  const qr = encodeQr(text)
  const dimension = (qr.size + margin * 2) * moduleSize
  let path = ''
  for (let row = 0; row < qr.size; row += 1) {
    for (let col = 0; col < qr.size; col += 1) {
      if (!qr.modules[row][col]) continue
      const x = (col + margin) * moduleSize
      const y = (row + margin) * moduleSize
      path += `M${x} ${y}h${moduleSize}v${moduleSize}h-${moduleSize}z`
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dimension}" height="${dimension}" `
    + `viewBox="0 0 ${dimension} ${dimension}" shape-rendering="crispEdges">`
    + `<rect width="${dimension}" height="${dimension}" fill="#fff"/>`
    + `<path d="${path}" fill="#000"/></svg>`
}

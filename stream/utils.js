/**
 * Encode a non-negative integer as a little-endian byte array.
 * The number of bytes needed is the minimum to represent the value.
 * @param {number} n
 * @returns {Uint8Array}
 */
export function numberToVar (n) {
  if (n < 0) throw new Error('n must be non-negative')
  if (!n) return new Uint8Array([0])
  const bytes = []
  while (n) {
    bytes.push(n & 0xff)
    n >>>= 8
  }
  return new Uint8Array(bytes)
}

/**
 * Decode a little-endian byte array back to a number.
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function varToNumber (bytes) {
  let n = 0
  for (let i = bytes.length - 1; i >= 0; i--) {
    n = (n * 256 + bytes[i]) >>> 0
  }
  return n
}

/**
 * @param {number} length
 * @returns {Array.<number>}
 */
export function range (length) {
  return Array.from({ length }, (_, i) => i)
}

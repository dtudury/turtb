export function addressToBytes (address) {
  if (address < 0) throw new Error('address must not be negative')
  if (!address) return new Uint8Array([0])
  const bytes = []
  while (address) {
    bytes.push(address & 0xff)
    address >>= 8
  }
  return bytes
}

export function bytesToAddress (bytes) {
  let address = 0
  bytes.reverse().forEach(byte => {
    address = (address << 8) | byte
  })
  return address
}

export function range (length) {
  return Array.from({ length }, (_, n) => n)
}

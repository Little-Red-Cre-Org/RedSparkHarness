/** Bounded JSON framing shared by the Chrome relay and the local browser provider. */
import type { Readable, Writable } from 'node:stream'

/** Chrome limits native-host messages to one MiB. Both directions use that same bound. */
export const MAX_FRAME_BYTES = 1024 * 1024

/**
 * Send one JSON message using Chrome's little-endian framing on supported Windows hosts.
 * @param stream - connected writable endpoint.
 * @param value - protocol message without credentials in diagnostics.
 */
export function sendFrame(stream: Writable, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value))
  if (body.length > MAX_FRAME_BYTES) throw new Error('Browser message exceeds the byte limit')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(body.length)
  stream.write(Buffer.concat([header, body]))
}

/**
 * Decode each bounded frame across arbitrary stream chunks; malformed input invokes onError.
 * @param stream - input endpoint.
 * @param receive - synchronous message admission.
 * @param onError - owner that closes the connection.
 * @returns listener disposer.
 */
export function receiveFrames(stream: Readable, receive: (value: unknown) => void, onError: () => void): () => void {
  let bytes: Buffer = Buffer.alloc(4)
  let filled = 0
  let readingBody = false
  let failed = false
  const data = (chunk: Buffer): void => {
    if (failed) return
    try {
      let offset = 0
      while (offset < chunk.length) {
        const take = Math.min(bytes.length - filled, chunk.length - offset)
        chunk.copy(bytes, filled, offset, offset + take)
        filled += take
        offset += take
        if (filled < bytes.length) continue
        if (!readingBody) {
          const length = bytes.readUInt32LE(0)
          if (length === 0 || length > MAX_FRAME_BYTES) throw new Error('Invalid browser frame length')
          bytes = Buffer.alloc(length)
          filled = 0
          readingBody = true
          continue
        }
        const value: unknown = JSON.parse(bytes.toString('utf8'))
        bytes = Buffer.alloc(4)
        filled = 0
        readingBody = false
        receive(value)
      }
    } catch {
      // Parse and admission errors invalidate this connection, without reflecting input or secrets.
      failed = true
      bytes = Buffer.alloc(4)
      filled = 0
      readingBody = false
      onError()
    }
  }
  const end = (): void => { if (filled !== 0 || readingBody) onError() }
  stream.on('data', data)
  stream.on('end', end)
  return () => { stream.off('data', data); stream.off('end', end); bytes = Buffer.alloc(4); filled = 0; readingBody = false }
}

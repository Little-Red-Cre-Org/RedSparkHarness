/** Frame decoding preserves JSON across stream chunk boundaries. */
import { PassThrough } from 'node:stream'
import { expect, it } from 'vitest'
import { receiveFrames, sendFrame } from '../src/wire.ts'

it.each([{ messages: [{ text: '中文🙂' }, { text: 'second' }, { text: 'third' }] }])(
  'decodes fragmented UTF-8 and consecutive frames in order',
  async ({ messages }) => {
    const frames = messages.map((message) => {
      const encoded = new PassThrough()
      sendFrame(encoded, message)
      return encoded.read() as Buffer
    })
    const [first, ...rest] = frames
    if (first === undefined) throw new Error('missing frame fixture')
    const input = new PassThrough()
    const received: unknown[] = []
    let errors = 0
    const detach = receiveFrames(input, (value) => { received.push(value) }, () => { errors += 1 })
    try {
      for (let index = 0; index < first.length - 2; index += 1) input.write(first.subarray(index, index + 1))
      expect(received).toEqual([])
      const ended = new Promise<void>((resolve) => { input.once('end', resolve) })
      input.end(Buffer.concat([first.subarray(first.length - 2), ...rest]))
      await ended
      expect(received).toEqual(messages)
      expect(errors).toBe(0)
    } finally {
      detach()
      input.destroy()
    }
  },
)

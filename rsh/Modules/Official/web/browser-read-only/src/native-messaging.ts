/** Private Chrome stdio-to-pipe relay. It does not launch a Harness application or own Sessions. */
import { readFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { z } from 'zod'
import { receiveFrames, sendFrame } from './wire.ts'

async function relay(): Promise<void> {
  const [file, expectedOrigin, actualOrigin] = process.argv.slice(2)
  if (file === undefined || expectedOrigin !== actualOrigin || !/^chrome-extension:\/\/[a-p]{32}\/$/u.test(actualOrigin ?? '')) {
    throw new Error('Browser relay origin rejected')
  }
  const config = z.object({ pipe: z.string().startsWith('\\\\.\\pipe\\redspark-browser-'),
    token: z.string().regex(/^[a-f0-9]{64}$/u) }).strict().parse(JSON.parse(await readFile(file, 'utf8')))
  const socket = createConnection(config.pipe)
  const closed = new Promise<void>((resolve) => { socket.once('close', () => { resolve() }) })
  const stop = (): void => { socket.destroy(); process.stdin.destroy() }
  socket.on('error', stop)
  process.stdin.on('error', stop)
  process.stdout.on('error', stop)
  process.stdin.once('end', stop)
  socket.once('connect', () => { sendFrame(socket, { type: 'hello', token: config.token }) })
  const detachInput = receiveFrames(process.stdin, (value) => { sendFrame(socket, value) }, stop)
  const detachOutput = receiveFrames(socket, (value) => { sendFrame(process.stdout, value) }, stop)
  await closed
  detachInput(); detachOutput(); process.stdin.destroy()
}

void relay().catch(() => {
  // Relay diagnostics never contain the private discovery file or authentication material.
  process.stderr.write('RedSpark browser connection unavailable. Check the local host and its registration.\n')
  process.exitCode = 1
})

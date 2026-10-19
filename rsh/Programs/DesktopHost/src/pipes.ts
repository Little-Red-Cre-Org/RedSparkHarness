/**
 * Electron's private byte pipes for the Desktop Host child process.
 *
 * The child inherits descriptors 3 and 4 and must close each exactly once. Node's `fs` streams own
 * an inherited descriptor whenever `autoClose` stays at its default: `destroy()` closes the read
 * end, and the write end closes when its final write finishes. Closing the descriptor separately
 * races that deferred close, and the loser reports `EBADF` back through the stream's `error` event,
 * which the Host treats as a transport failure on an otherwise clean shutdown.
 */

import { createReadStream, createWriteStream } from 'node:fs'
import type { Readable, Writable } from 'node:stream'
import { DESKTOP_REQUEST_PIPE_FD, DESKTOP_RESPONSE_PIPE_FD } from './wire.ts'

/** Both byte pipes carried by one Desktop Host process. */
export interface DesktopHostPipes {
  /** Frames written by Electron. */
  readonly requests: Readable
  /** Frames written by this process. */
  readonly responses: Writable
  /** @returns Completion after both descriptors are closed. */
  close(): Promise<void>
}

/**
 * Open the inherited request and response descriptors as streams that own them.
 * @param requestFd - descriptor carrying Electron request frames.
 * @param responseFd - descriptor carrying Host response frames.
 * @returns the open pipes and their single-shot teardown.
 */
export function openDesktopHostPipes(
  requestFd: number = DESKTOP_REQUEST_PIPE_FD,
  responseFd: number = DESKTOP_RESPONSE_PIPE_FD,
): DesktopHostPipes {
  const requests = createReadStream('', { fd: requestFd })
  const responses = createWriteStream('', { fd: responseFd })
  let closing: Promise<void> | undefined
  return {
    requests,
    responses,
    close(): Promise<void> {
      closing ??= (async () => {
        requests.destroy()
        // `end()` closes the descriptor once its queued writes drain; destroying first would
        // abort bytes the response pipe has not accepted yet.
        if (!responses.destroyed) await new Promise<void>((resolve) => { responses.end(resolve) })
        responses.destroy()
      })()
      return closing
    },
  }
}

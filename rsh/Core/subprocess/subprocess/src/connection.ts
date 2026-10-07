/** Shared EOF, provider-termination, and managed-range disposal for child connections. */

import type { ChildConnectionHandle } from './types.ts'

/**
 * Close child stdin, allow the peer to flush, then terminate and await its
 * complete managed range. The Provider owns the platform-specific TERM/KILL
 * sequence; this caller owns the EOF and final observation deadlines.
 * @param connection - owned child process and raw stdio streams.
 * @param graces - EOF window and Provider termination grace in milliseconds.
 * @throws when the Provider cannot confirm the managed range is empty.
 */
export async function disposeChildConnection(
  connection: ChildConnectionHandle,
  graces: { eofGraceMs: number; terminationGraceMs: number },
): Promise<void> {
  connection.stdin.end()
  if (await waitForExitWithin(connection, graces.eofGraceMs)) return

  connection.terminate()
  const exitWaitMs = graces.terminationGraceMs * 2
  if (!await waitForExitWithin(connection, exitWaitMs)) {
    throw new Error(`managed subprocess range did not exit within ${exitWaitMs}ms after termination`)
  }
}

/** Bound a managed-range wait without cancelling the Provider's shared observation. */
function waitForExitWithin(connection: ChildConnectionHandle, ms: number): Promise<boolean> {
  const timeout = new AbortController()
  const timer = setTimeout(() => { timeout.abort() }, ms)
  return connection.waitForExit(timeout.signal).finally(() => { clearTimeout(timer) })
}

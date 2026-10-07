/** SDK-facing regressions for Core's shared child-connection lifetime. */

import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { disposeChildConnection, type ChildConnectionHandle } from '@deepseek-ai/dsh-subprocess/native'

interface ConnectionScript {
  readonly exitsOn: 'eof' | 'terminate' | 'never'
}

function connection(script: ConnectionScript): { handle: ChildConnectionHandle; terminations: number } {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let rangeEmpty = false
  let terminations = 0
  const waiters = new Set<() => void>()
  const settle = (): void => {
    rangeEmpty = true
    for (const waiter of waiters) waiter()
    waiters.clear()
  }
  stdin.once('finish', () => { if (script.exitsOn === 'eof') settle() })
  const handle = {
    stdin,
    stdout,
    stderr,
    collected: {},
    done: Promise.resolve({ exitCode: 0, signal: null }),
    terminate() {
      terminations += 1
      if (script.exitsOn === 'terminate') settle()
    },
    waitForExit(signal?: AbortSignal) {
      if (rangeEmpty) return Promise.resolve(true)
      return new Promise<boolean>((resolve) => {
        const onAbort = (): void => { waiters.delete(onExit); resolve(false) }
        const onExit = (): void => { signal?.removeEventListener('abort', onAbort); resolve(true) }
        waiters.add(onExit)
        signal?.addEventListener('abort', onAbort, { once: true })
      })
    },
  } as ChildConnectionHandle
  return { handle, get terminations() { return terminations } }
}

describe('disposeChildConnection', () => {
  it.each([
    { exitsOn: 'eof' as const, expectedTerminations: 0, rejects: false },
    { exitsOn: 'terminate' as const, expectedTerminations: 1, rejects: false },
    { exitsOn: 'never' as const, expectedTerminations: 1, rejects: true },
  ])('waits for owned-range release after $exitsOn', async ({ exitsOn, expectedTerminations, rejects }) => {
    const child = connection({ exitsOn })
    const disposed = disposeChildConnection(child.handle, { eofGraceMs: 10, terminationGraceMs: 10 })
    if (rejects) await expect(disposed).rejects.toThrow('managed subprocess range did not exit')
    else await disposed
    expect(child.terminations).toBe(expectedTerminations)
  })
})

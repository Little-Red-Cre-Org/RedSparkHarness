/** Direct controller observation complements the same real TTY lifecycle case. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, vi } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm/native'
import { SessionId } from '@deepseek-ai/dsh-session/native'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { TerminalController, type TerminalExecution } from '../src/controller.ts'
import { resolveNativeTuiConfig } from '../src/config.ts'

/** Exercise admission, cleanup barriers and restore without allocating a second Session writer.
 * @param workspace - existing fixture workspace for explicit configuration validation.
 * @returns completion after each selected executor interval and observer drains.
 */
export async function controllerProof(workspace: string): Promise<void> {
  const config = { cwd: workspace, provider: 'fixture', model: 'fixture', systemPrompt: 'Terminal proof', locale: 'en',
    background: '#000000', maxQueuedInputs: 1, maxHistoryEvents: 100, maxTranscriptEvents: 3, maxStreamChunks: 2 }
  for (const invalid of [null, { ...config, locale: 'invalid' }, { ...config, background: 'invalid' },
    ...['maxQueuedInputs', 'maxHistoryEvents', 'maxTranscriptEvents', 'maxStreamChunks'].map(key => ({ ...config, [key]: 0 }))]) {
    expect(() => resolveNativeTuiConfig(invalid)).toThrow()
  }
  const settings = resolveNativeTuiConfig(config)
  const events = parseSessionLog(readFileSync(fileURLToPath(new URL('../../../../../snapshots/native-tui/interactive/session.v3.jsonl', import.meta.url)), 'utf8'))
  const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Controller input' }] })
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    for (const mode of ['normal', 'failed', 'cancelled', 'cancel-result', 'cleanup-failure'] as const) {
      const owner = new AbortController()
      const launch = new AbortController()
      const entered = Promise.withResolvers<undefined>()
      const released = Promise.withResolvers<undefined>()
      const open = vi.fn(async () => undefined)
      let calls = 0
      const execution: TerminalExecution = {
        open, history: async () => events,
        turn: async (request, signal) => {
          calls++
          entered.resolve(undefined)
          for (const event of events) request.onEvent?.(event)
          request.onChunk?.({ type: 'text-delta', index: 0, text: 'live' })
          if (mode === 'normal' || mode === 'failed') return { exitCode: mode === 'normal' ? 0 : 1 }
          entered.resolve(undefined)
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve()
            else signal.addEventListener('abort', () => { resolve() }, { once: true })
          })
          await released.promise
          if (mode === 'cancel-result') return { exitCode: 130 }
          if (mode === 'cleanup-failure') throw new Error('cleanup failed')
          throw signal.reason
        },
      }
      const controller = new TerminalController(execution, owner.signal, settings, SessionId('controller-session'))
      try {
        await controller.initialize([], launch.signal)
        const observe = vi.fn()
        const remove = controller.subscribe(observe)
        const bad = controller.subscribe(() => { throw new Error('observer failure') })
        controller.cancel()
        controller.submit(message)
        await entered.promise
        controller.submit(message)
        expect(() =>{  controller.submit(message) }).toThrow('Input queue is full')
        if (mode === 'normal' || mode === 'failed') {
          await controller.settle()
          expect(calls).toBe(2)
          expect(controller.snapshot().error).toBe(mode === 'normal' ? undefined : 'Turn failed')
          expect(controller.snapshot().events).toHaveLength(3)
          remove(); bad()
          await controller.initialize(['--resume', 'restored-session'], launch.signal)
          expect(open.mock.calls.at(-1)).toMatchObject([SessionId('restored-session'), true, expect.any(AbortSignal)])
          owner.abort(new Error('owner stopped'))
          expect(() =>{  controller.submit(message) }).toThrow('Terminal is closed')
          expect(controller.status(launch.signal)).toBe(130)
        } else {
          await entered.promise
          expect(controller.snapshot().busy).toBe(true)
          controller.cancel()
          expect(controller.snapshot().queued).toBe(0)
          const closing = controller.close()
          expect(controller.close()).toBe(closing)
          expect(controller.snapshot().busy).toBe(true)
          released.resolve(undefined)
          await closing
          expect(calls).toBe(1)
          expect(controller.snapshot().busy).toBe(false)
          if (mode === 'cleanup-failure') expect(() => controller.status(launch.signal)).toThrow('Turn failed')
          else { expect(controller.snapshot().error).toBe('Cancelled'); expect(controller.status(launch.signal)).toBe(0) }
        }
        expect(observe).toHaveBeenCalled()
        await controller.close()
        expect(() =>{  controller.submit(message) }).toThrow('Terminal is closed')
      } finally { released.resolve(undefined); await controller.close() }
    }
    const launch = new AbortController()
    const controller = new TerminalController({
      turn: async () => ({ exitCode: 0 }), open: async () => { throw new Error('restore refused') }, history: async () => [],
    }, new AbortController().signal, settings, SessionId('refused-session'))
    try {
      for (const args of [['bad'], ['--resume', ''], ['--resume', 'id', 'extra']]) await expect(controller.initialize(args, launch.signal)).rejects.toThrow()
      await expect(controller.initialize([], launch.signal)).rejects.toThrow('restore refused')
      launch.abort(new Error('launcher stopped'))
      await expect(controller.initialize([], launch.signal)).rejects.toThrow('launcher stopped')
      expect(controller.status(launch.signal)).toBe(130)
      controller.exit()
      await controller.waitForExit()
    } finally { await controller.close() }
  } finally { log.mockRestore() }
}

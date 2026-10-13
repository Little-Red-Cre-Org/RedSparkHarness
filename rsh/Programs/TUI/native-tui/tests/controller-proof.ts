/** Direct controller observation complements the same real TTY lifecycle case. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, vi } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm/native'
import { SessionId } from '@deepseek-ai/dsh-session/native'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { TerminalController, type TerminalExecution } from '../src/controller.ts'
import { resolveNativeTuiConfig } from '../src/config.ts'
import type { NativeAdmittedUserQuestionRequest } from '@deepseek-ai/dsh-user-questions/native'
import { CommandId } from '@deepseek-ai/dsh-commands/native'

/** Exercise admission, cleanup barriers and restore without allocating a second Session writer.
 * @param workspace - existing fixture workspace for explicit configuration validation.
 * @returns completion after each selected executor interval and observer drains.
 */
export async function controllerProof(workspace: string): Promise<void> {
  const config = { cwd: workspace, provider: 'fixture', model: 'fixture', systemPrompt: 'Terminal proof', locale: 'en',
    background: '#000000', maxQueuedInputs: 1, maxHistoryEvents: 100, maxTranscriptEvents: 3, maxStreamChunks: 2, maxPendingHumanRequests: 2 }
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
        open, history: async () => events, sessions: async () => [],
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
    {
      const owner = new AbortController()
      const releases = [Promise.withResolvers<undefined>(), Promise.withResolvers<undefined>(), Promise.withResolvers<undefined>()]
      const entered = [Promise.withResolvers<AbortSignal>(), Promise.withResolvers<AbortSignal>(), Promise.withResolvers<AbortSignal>()]
      let call = 0
      const controller = new TerminalController({
        turn: async () => ({ exitCode: 0 }), open: async () => undefined, history: async () => [], sessions: async () => [],
        skillInvocations: { canInvoke: async (_name, _id, signal) => {
          const index = call++
          entered[index]!.resolve(signal)
          await releases[index]!.promise
          return true
        } },
      }, owner.signal, settings, SessionId('controller-skill-lookup'))
      const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '/archify diagram' }] })
      let human: Promise<unknown> | undefined
      let handledHuman: Promise<void> | undefined
      try {
        await controller.initialize([], new AbortController().signal)
        const cancelled = controller.dispatchSlash('/archify diagram', 'archify', message)
        expect((await entered[0]!.promise).aborted).toBe(false)
        controller.cancel()
        expect((await entered[0]!.promise).aborted).toBe(true)
        releases[0]!.resolve(undefined)
        await expect(cancelled).resolves.toBeUndefined()
        expect(controller.snapshot().queued).toBe(0)

        const humanInterrupted = controller.dispatchSlash('/archify diagram', 'archify', message)
        const humanSignal = new AbortController()
        human = controller.human.questions({ questions: [{ id: 'skill-lookup', question: 'Continue?' }],
          signal: humanSignal.signal } as NativeAdmittedUserQuestionRequest)
        handledHuman = human.then(() => undefined, () => undefined)
        const prompt = controller.snapshot().human
        expect(prompt?.kind).toBe('question')
        expect((await entered[1]!.promise).aborted).toBe(true)
        if (prompt === undefined) throw new Error('controller omitted the pending human prompt')
        controller.answerHuman('yes', prompt)
        await human
        releases[1]!.resolve(undefined)
        await expect(humanInterrupted).resolves.toBeUndefined()
        expect(controller.snapshot().queued).toBe(0)

        const closed = controller.dispatchSlash('/archify diagram', 'archify', message)
        await entered[2]!.promise
        let closeResolved = false
        const closing = controller.close().then(() => { closeResolved = true })
        await Promise.resolve()
        expect(closeResolved).toBe(false)
        releases[2]!.resolve(undefined)
        await expect(closed).resolves.toBeUndefined()
        await closing
        expect(controller.snapshot().queued).toBe(0)
      } finally {
        for (const release of releases) release.resolve(undefined)
        await controller.close()
        await handledHuman
      }
    }
    {
      const routeSettings = resolveNativeTuiConfig({ ...config, maxQueuedInputs: 3 })
      const owner = new AbortController()
      const commandReleases = [Promise.withResolvers<undefined>(), Promise.withResolvers<undefined>()]
      const commandEntered = [Promise.withResolvers<undefined>(), Promise.withResolvers<undefined>()]
      const skillReleases = [Promise.withResolvers<undefined>(), Promise.withResolvers<undefined>()]
      const skillEntered = [Promise.withResolvers<AbortSignal>(), Promise.withResolvers<AbortSignal>()]
      const afterMissingEntered = Promise.withResolvers<undefined>()
      const afterMissingRelease = Promise.withResolvers<undefined>()
      const activeTurnEntered = Promise.withResolvers<undefined>()
      const activeTurnRelease = Promise.withResolvers<undefined>()
      const turns: string[] = []
      let commandCalls = 0
      let skillCalls = 0
      const input = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
      const controller = new TerminalController({
        open: async () => undefined, history: async () => [], sessions: async () => [],
        commands: {
          list: async () => [],
          dispatch: async (_id, line) => {
            if (line === '/pause') return { commandId: CommandId('pause'), result: { kind: 'success', text: 'Paused' } }
            if (line === '/missing') return undefined
            const index = commandCalls++
            commandEntered[index]!.resolve(undefined)
            await commandReleases[index]!.promise
            return undefined
          },
        },
        skillInvocations: { canInvoke: async (name, _id, signal) => {
          const index = skillCalls++
          if (index < skillEntered.length) {
            skillEntered[index]!.resolve(signal)
            await skillReleases[index]!.promise
          }
          return name === 'archify'
        } },
        turn: async (request) => {
          const message = request.message
          if (message === undefined) throw new Error('native-tui controller proof received no turn message')
          const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('')
          turns.push(text)
          if (text === 'after missing') {
            afterMissingEntered.resolve(undefined)
            await afterMissingRelease.promise
          }
          if (text === 'active') {
            activeTurnEntered.resolve(undefined)
            await activeTurnRelease.promise
          }
          return { exitCode: 0 }
        },
      }, owner.signal, routeSettings, SessionId('controller-skill-fifo'))
      const launch = new AbortController()
      try {
        await controller.initialize([], launch.signal)
        const first = controller.dispatchSlash('/archify first', 'archify', input('/archify first'))
        await commandEntered[0]!.promise
        controller.submit(input('between'))
        const second = controller.dispatchSlash('/archify second', 'archify', input('/archify second'))
        await commandEntered[1]!.promise
        commandReleases[1]!.resolve(undefined)
        await skillEntered[0]!.promise
        skillReleases[0]!.resolve(undefined)
        await expect(second).resolves.toEqual({ kind: 'skill' })
        expect(turns).toEqual([])
        commandReleases[0]!.resolve(undefined)
        await skillEntered[1]!.promise
        skillReleases[1]!.resolve(undefined)
        await expect(first).resolves.toEqual({ kind: 'skill' })
        await controller.settle()
        expect(turns).toEqual(['/archify first', 'between', '/archify second'])
        await expect(controller.dispatchSlash('/missing', 'missing', input('/missing'))).resolves.toEqual({ kind: 'unknown' })
        controller.submit(input('after missing'))
        let settled = false
        const settling = controller.settle().then(() => { settled = true })
        await afterMissingEntered.promise
        await Promise.resolve()
        expect(settled).toBe(false)
        afterMissingRelease.resolve(undefined)
        await settling
        expect(turns).toEqual(['/archify first', 'between', '/archify second', 'after missing'])

        controller.submit(input('active'))
        await activeTurnEntered.promise
        controller.submit(input('queued one'))
        controller.submit(input('queued two'))
        controller.submit(input('queued three'))
        expect(controller.snapshot().queued).toBe(3)
        await expect(controller.dispatchSlash('/pause', 'pause', input('/pause'))).resolves.toMatchObject({
          kind: 'command', execution: { result: { kind: 'success', text: 'Paused' } },
        })
        expect(turns).toEqual(['/archify first', 'between', '/archify second', 'after missing', 'active'])
        activeTurnRelease.resolve(undefined)
        await controller.settle()
        expect(turns.slice(5)).toEqual(['queued one', 'queued two', 'queued three'])
      } finally {
        for (const release of commandReleases) release.resolve(undefined)
        for (const release of skillReleases) release.resolve(undefined)
        afterMissingRelease.resolve(undefined)
        activeTurnRelease.resolve(undefined)
        await controller.close()
      }
    }
    const launch = new AbortController()
    const controller = new TerminalController({
      turn: async () => ({ exitCode: 0 }), open: async () => { throw new Error('restore refused') }, history: async () => [], sessions: async () => [],
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

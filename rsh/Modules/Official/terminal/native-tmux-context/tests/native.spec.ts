/** Native tmux-context scheduling from committed Session events. */
import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/native'
import type { ShellExecRequest, ShellExecSpec, ShellOperations, ShellRunResult } from '@deepseek-ai/dsh-shell/native'
import { NativeTmuxContextProvider, resolveNativeTmuxContextConfig } from '../src/index.ts'

const LOCATION = [
  'work', '2', 'editor', '1', '%3', '1', '1', 'layout-3',
].join('\\t')

function runResult(stdout: string, exitCode = 0): ShellRunResult {
  return {
    exitCode, signal: null, timedOut: false, aborted: false, timeoutMs: 30_000,
    stdout: { text: stdout, truncated: false }, stderr: { text: '', truncated: false },
  }
}

function shell(run: (spec: ShellExecSpec) => Promise<ShellRunResult>): {
  readonly api: Pick<ShellOperations, 'resolve' | 'run'>
  readonly commands: string[]
} {
  const commands: string[] = []
  const api: Pick<ShellOperations, 'resolve' | 'run'> = {
    resolve(request: ShellExecRequest): ShellExecSpec {
      commands.push(request.command)
      return {
        command: request.command,
        workdir: request.workdir ?? process.cwd(),
        timeoutMs: request.timeoutMs ?? 30_000,
        stdoutMaxBytes: request.stdoutMaxBytes ?? 64_000,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        sandboxPolicy: request.sandboxPolicy,
      }
    },
    run,
  }
  return { api, commands }
}

function startTurn(session: Session, turn: number): SessionEvent {
  return session.append('turn/start', { turn })
}

function messageText(message: ReturnType<typeof createUserMessage> | undefined): string {
  const block = message?.content[0]
  if (block?.type !== 'text') throw new Error('expected one tmux text block')
  return block.text
}

describe('NativeTmuxContextProvider', () => {
  it('persists a changed location and suppresses it after Session reconstruction', async () => {
    const fakeShell = shell(async () => runResult(`${LOCATION}\n`))
    const lifetime = new AbortController().signal
    const session = Session.create(SessionId('native-tmux-context'))
    session.append('turn/start', { turn: 1 })
    const context = new NativeTmuxContextProvider(resolveNativeTmuxContextConfig({}), fakeShell.api, lifetime, 321)
    context.seed(session, session.snapshotEvents())

    const first = await context.prepare({ session, turn: 1, step: 1, signal: lifetime })

    expect(messageText(first)).toBe('tmux location (turn 1):\nsession work, window 2 "editor", pane 1 %3\nwindow active=1, pane active=1, layout layout-3')
    expect(first?.source).toMatchObject({
      kind: 'plugin', plugin: 'native-tmux-context', form: 'snapshot', sections: [{ name: 'native-tmux-context' }],
    })
    expect(fakeShell.commands[0]).toContain('ps -o tty= -p 321')
    expect(fakeShell.commands[0]).toContain('#{pane_tty}')
    if (first === undefined) throw new Error('missing initial tmux reading')
    context.record(session, session.append('user/message', first, { surfaceOp: 'append' }))
    context.record(session, session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }))
    context.record(session, startTurn(session, 2))

    const restored = Session.fromRestore(
      session.id, session.snapshotEvents(), { ...session.header }, session.inheritedEventCount, 'detached',
    )
    const resumed = new NativeTmuxContextProvider(resolveNativeTmuxContextConfig({}), fakeShell.api, lifetime, 321)
    resumed.seed(restored, restored.snapshotEvents())
    const second = await resumed.prepare({ session: restored, turn: 2, step: 1, signal: lifetime })

    expect(second).toBeUndefined()
    expect(fakeShell.commands).toHaveLength(2)
    expect(restored.snapshotEvents().filter(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin' && event.data.source.plugin === 'native-tmux-context')).toHaveLength(1)
  })

  it.each([
    ['outside tmux', runResult('', 1)],
    ['empty pane id', runResult(['work', '2', 'editor', '1', '', '1', '1', 'layout-3'].join('\\t'))],
  ])('does not inject for %s', async (_label, result) => {
    const fakeShell = shell(async () => result)
    const signal = new AbortController().signal
    const session = Session.create(SessionId(`native-tmux-${_label.replaceAll(' ', '-')}`))
    session.append('turn/start', { turn: 1 })
    const context = new NativeTmuxContextProvider(resolveNativeTmuxContextConfig({}), fakeShell.api, signal, 321)
    context.seed(session, session.snapshotEvents())

    expect(await context.prepare({ session, turn: 1, step: 1, signal })).toBeUndefined()
    expect(session.snapshotEvents().filter(event => event.type === 'user/message')).toHaveLength(0)
  })

  it('settles an aborted query before rejecting preparation', async () => {
    let resolveRun: ((result: ShellRunResult) => void) | undefined
    let markAborted: (() => void) | undefined
    const aborted = new Promise<void>((resolve) => { markAborted = resolve })
    const fakeShell = shell(spec => new Promise((resolve) => {
      resolveRun = resolve
      spec.signal?.addEventListener('abort', () => markAborted?.(), { once: true })
    }))
    const controller = new AbortController()
    const reason = new Error('request cancelled')
    const session = Session.create(SessionId('native-tmux-cancel'))
    session.append('turn/start', { turn: 1 })
    const context = new NativeTmuxContextProvider(resolveNativeTmuxContextConfig({}), fakeShell.api,
      new AbortController().signal, 321)
    context.seed(session, session.snapshotEvents())
    let settled = false
    const preparing = context.prepare({ session, turn: 1, step: 1, signal: controller.signal })
      .then((value) => { settled = true; return { value } }, (error: unknown) => { settled = true; return { error } })

    controller.abort(reason)
    await aborted
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(settled).toBe(false)
    resolveRun?.(runResult(`${LOCATION}\n`))
    const outcome = await preparing

    expect(outcome).toEqual({ error: reason })
    expect(session.snapshotEvents().filter(event => event.type === 'user/message')).toHaveLength(0)
  })
})

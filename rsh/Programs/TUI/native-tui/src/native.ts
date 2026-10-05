/** Native Ink bootstrap over the selected terminal conversation controller. */
import { randomUUID } from 'node:crypto'
import React from 'react'
import { render, type Instance } from 'ink'
import type { NativeApplication, NativeContext, NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-native-session-execution/native'
import type {} from '@deepseek-ai/dsh-native-model-execution/native'
import { createNativeHeadlessApplication, type NativeHeadlessApplication } from '@deepseek-ai/dsh-native-headless/native'
import { readNativeSessionHistory } from '@deepseek-ai/dsh-native-session-execution/read-history'
import { SessionId } from '@deepseek-ai/dsh-session/native'
import { TerminalView } from './presentation.ts'
import { TerminalController } from './controller.ts'
import { resolveNativeTuiConfig, type Config } from './config.ts'
import { terminalCopy } from './locale.ts'
import type { NativeModelSelectionOperations } from '@deepseek-ai/dsh-native-model-selection/native'
import type { NativeModelDirectory } from '@deepseek-ai/dsh-native-model-execution/model-directory'
import { terminalModelOperations } from './models.ts'
import type {} from '@deepseek-ai/dsh-user-questions/native'
import { bindTerminalHumanAnswerers } from './human.ts'
export { resolveNativeTuiConfig } from './config.ts'
export type { Config } from './config.ts'

/** The Program owns terminal IO; its controller owns conversation admission and settlement. */
export class NativeTuiApplication extends TerminalController implements NativeApplication {
  private ink: Instance | undefined
  private closingInk: Promise<void> | undefined
  /**
   * @param context - selected native installation authorities.
   * @param executor - selected sole Session execution owner.
   * @param config - resolved terminal settings.
   * @param selection - optional Session selection Provider.
   * @param directory - optional actual model directory Provider.
   */
  constructor(context: NativeContext, executor: NativeHeadlessApplication, config: Config,
    selection?: NativeModelSelectionOperations, directory?: NativeModelDirectory) {
    super({
      sessions: async signal => (await context.require('sessionPersistence').list({ signal }))
        .filter(row => row.header.cwd === config.cwd).map(row => row.header.id),
      models: selection !== undefined && directory !== undefined
        ? terminalModelOperations(executor, selection, directory, config, agent => context.require('agents').execution(agent)) : undefined,
      turn: (request, signal) => executor.executeRootTurn(request, signal),
      open: async (id, resume, signal) => {
        await executor.executeSessionOperation({ id, resume }, () => Promise.resolve(undefined), signal)
      },
      history: async (id, signal) => (await readNativeSessionHistory(id, {
        active: context.require('activeSessions'), persistence: context.require('sessionPersistence'),
        maxHistoryEvents: config.maxHistoryEvents, label: 'native-tui',
        onCleanupFailure: (error) => { console.error('native-tui: reader cleanup failed', error) },
      }, signal)).events,
    }, context.signal, config, SessionId('session-' + randomUUID()))
    bindTerminalHumanAnswerers(this.human, context.require('activeSessions'), id => this.ownsSession(id), context,
      context.optional('approval'), context.optional('userQuestions'))
  }
  /** Launch Ink after the controller restores the selected Session.
   * @param args - explicit terminal argv.
   * @param signal - launcher cancellation.
   * @returns process status after accepted execution and Ink drain.
   */
  async run(args: readonly string[], signal: AbortSignal): Promise<number> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error(terminalCopy(this.config.locale).requiresTerminal)
    try {
      await this.initialize(args, signal)
      this.ink = render(React.createElement(TerminalView, { interaction: this, locale: this.config.locale,
        model: { provider: this.config.provider, model: this.config.model,
          ...this.config.reasoningEffort === undefined ? {} : { reasoningEffort: String(this.config.reasoningEffort) } },
        background: this.config.background }), { exitOnCtrlC: false })
      await this.waitForExit()
    } finally { await this.close() }
    return this.status(signal)
  }
  /** Withdraw terminal IO after the controller settles its accepted execution.
   * @returns idempotent completion of terminal resource cleanup.
   */
  override close(): Promise<void> {
    return this.closingInk ??= (async () => {
      const failures: unknown[] = []
      try { await super.close() }
      catch (error: unknown) { failures.push(error) }
      finally {
        try {
          const exited = this.ink?.waitUntilExit()
          this.ink?.unmount()
          await exited
        } catch (error: unknown) { failures.push(error) }
      }
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) throw new AggregateError(failures, 'native-tui: execution and terminal cleanup failed')
    })()
  }
}

/** Native terminal application installer; legacy RSH defaults remain separate. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-tui', targets: ['host'],
  requires: ['fs', 'sessionPersistence', 'modelExecution', 'agents', 'sessionExecution', 'activeSessions'],
  optional: ['tools', 'promptSections', 'sandboxPolicy', 'approval', 'codeRuntime', 'timeContext', 'agentPresets', 'workspaceRegistry', 'agentInstructions', 'modelSelection', 'modelDirectory', 'userQuestions'],
  provides: ['application', 'rootExecution'],
  resolve(input) {
    const config = resolveNativeTuiConfig(input)
    return (context) => {
      const { locale: _locale, background: _background, maxQueuedInputs: _queue, maxHistoryEvents: _history,
        maxTranscriptEvents: _transcript, maxStreamChunks: _stream, maxPendingHumanRequests: _human, ...turn } = config
      const executor = createNativeHeadlessApplication(context, turn, context.scope, {
        execution: context.require('sessionExecution'), active: context.require('activeSessions'),
      })
      const application = new NativeTuiApplication(context, executor, config, context.optional('modelSelection'), context.optional('modelDirectory'))
      context.own(() => application.close())
      context.provide('application', application)
      context.provide('rootExecution', executor.rootExecution)
    }
  },
}

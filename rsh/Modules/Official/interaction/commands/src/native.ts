/** Scoped native human command Provider using the Program's single durable writer. */
import { randomUUID } from 'node:crypto'
import { NativeContributions, type NativePlugin, type NativeScope } from '@deepseek-ai/dsh-native-runtime'
import type { NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import { CommandId } from './brand.ts'
import { parseCommand } from './parse.ts'
import type { CommandDescriptor, CommandExecution, CommandResult } from './facts.ts'
import type { NativeCommandDefinition, NativeCommandOperations, NativeCommandRequest } from './native-types.ts'

export type * from './native-types.ts'
export { parseCommand } from './parse.ts'
export { CommandId, CommandDefinitionId } from './brand.ts'

interface Registration {
  readonly definition: NativeCommandDefinition
  readonly controller: AbortController
  readonly pending: Set<Promise<CommandExecution>>
  release: () => Promise<void>
}
interface Dispatch {
  readonly owner: NativeActiveSessionOwner
  readonly controller: AbortController
  readonly result: Promise<CommandExecution>
}

/** Provider owns handler cancellation/drain; Programs own command admission and Session lifetime. */
export class NativeCommandRegistry implements NativeCommandOperations {
  private readonly commands: NativeContributions<Registration>
  private readonly registrations = new Set<Registration>()
  private readonly accepted = new Set<Dispatch>()
  private readonly removeDetached: () => Promise<void>
  private readonly lifetime = new AbortController()
  private disposal: Promise<void> | undefined

  /**
   * @param scope - Provider visibility realm.
   * @param agents - exact live Agent identities.
   * @param sessions - Program-owned active Session lookup.
   * @param signal - Provider contribution lifetime.
   */
  constructor(scope: NativeScope, private readonly agents: NativeAgentRegistry,
    private readonly sessions: NativeActiveSessionOperations, private readonly signal: AbortSignal) {
    this.commands = new NativeContributions(scope)
    this.removeDetached = sessions.onDetached(async (owner) => {
      const dispatches = [...this.accepted].filter(entry => entry.owner === owner)
      for (const entry of dispatches) entry.controller.abort(new Error('Command Session owner released'))
      await Promise.allSettled(dispatches.map(entry => entry.result))
    })
  }

  /** @inheritdoc */
  register(definition: NativeCommandDefinition, scope?: NativeScope): () => Promise<void> {
    this.assertAccepting()
    if (!/^[a-z][a-z0-9_-]*$/u.test(definition.name) || definition.description.trim().length === 0) {
      throw new Error('commands: command name or description is invalid')
    }
    const entry: Registration = { definition: Object.freeze({ ...definition,
      ...definition.input === undefined ? {} : { input: Object.freeze({ ...definition.input }) } }),
    controller: new AbortController(), pending: new Set(), release: async () => {} }
    const remove = this.commands.register(definition.name, entry, scope)
    this.registrations.add(entry)
    let disposal: Promise<void> | undefined
    entry.release = () => {
      if (disposal !== undefined) return disposal
      remove()
      this.registrations.delete(entry)
      entry.controller.abort(new Error(`Command /${definition.name} unloaded`))
      return disposal = Promise.allSettled([...entry.pending]).then(() => undefined)
    }
    return entry.release
  }

  /** @inheritdoc */
  parse(line: string): ReturnType<typeof parseCommand> { return parseCommand(line) }

  /** @inheritdoc */
  list(scope: NativeScope): readonly CommandDescriptor[] {
    this.assertAccepting()
    return Object.freeze([...this.commands.visible(scope).values()].map(({ definition }) => Object.freeze({
      name: definition.name, description: definition.description,
      ...definition.definitionId === undefined ? {} : { definitionId: definition.definitionId },
      ...definition.input === undefined ? {} : { input: definition.input },
    })))
  }

  /** @inheritdoc */
  async dispatch(request: NativeCommandRequest): Promise<CommandExecution | undefined> {
    this.assertAccepting()
    request.signal.throwIfAborted()
    const parsed = parseCommand(request.line)
    if (parsed === undefined) return undefined
    if (this.agents.get(request.agent.id) !== request.agent) throw new Error('commands: Agent is not live')
    const entry = this.commands.visible(request.agent.scope).get(parsed.name)
    if (entry === undefined) return undefined
    const owner = this.sessions.owner(request.agent, request.session)
    if (owner === undefined || owner.invocation !== 'root') throw new Error('commands: an exact root Session owner is required')
    const controller = new AbortController()
    const signal = AbortSignal.any([request.signal, controller.signal, entry.controller.signal, this.signal, this.lifetime.signal])
    signal.throwIfAborted()
    const commandId = CommandId(randomUUID())
    const completion = Promise.withResolvers<CommandExecution>()
    const dispatch: Dispatch = { owner, controller, result: completion.promise }
    this.accepted.add(dispatch)
    entry.pending.add(completion.promise)
    const removeAgent = this.agents.onDispose(request.agent, async () => {
      controller.abort(new Error('Command Agent released'))
      await Promise.allSettled([completion.promise])
    })
    void (async () => {
      try {
        owner.append('command/run', { commandId, name: parsed.name, source: { kind: 'user' },
          ...entry.definition.recordInput === false ? {} : { args: parsed.rawInput } })
        await owner.flush()
        let result: CommandResult
        try {
          signal.throwIfAborted()
          result = request.attachments.length > 0 && entry.definition.input?.attachments !== true
            ? { kind: 'error', text: `/${parsed.name} does not accept attachments` }
            : await entry.definition.handler({ commandId, agent: request.agent, owner, rawInput: parsed.rawInput,
              attachments: Object.freeze([...request.attachments]), signal })
          signal.throwIfAborted()
        } catch (failure: unknown) {
          result = { kind: 'error', text: failure instanceof Error ? failure.message : String(failure) }
        }
        owner.append('command/done', { commandId, kind: result.kind,
          ...result.text === undefined ? {} : { text: result.text },
          ...result.kind === 'success' && result.sourceEventSeq !== undefined ? { sourceEventSeq: result.sourceEventSeq } : {} })
        await owner.flush()
        completion.resolve({ commandId, result })
      } catch (failure: unknown) { completion.reject(failure) }
      finally { removeAgent(); entry.pending.delete(completion.promise); this.accepted.delete(dispatch) }
    })()
    return await completion.promise
  }

  /** Cancel accepted handlers and wait for durable settlement. @returns memoized Provider release. */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.lifetime.abort(new Error('Command Provider unloaded'))
    for (const dispatch of this.accepted) dispatch.controller.abort(this.lifetime.signal.reason)
    const pending = [...this.accepted].map(dispatch => dispatch.result)
    return this.disposal = (async () => {
      await Promise.all([...this.registrations].map(entry => entry.release()))
      await Promise.allSettled(pending)
      await this.removeDetached()
      this.commands.clear()
    })()
  }

  private assertAccepting(): void {
    if (this.signal.aborted || this.lifetime.signal.aborted) throw new Error('commands: Provider admission is closed')
  }
}

/** Native command Provider, selected independently of UI and model capabilities. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-commands', targets: ['host'],
  requires: ['agents', 'activeSessions'], provides: ['commands'],
  resolve(input) {
    if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 0)) {
      throw new Error('commands: configuration must be an empty object')
    }
    return (context) => {
      const commands = new NativeCommandRegistry(context.scope, context.require('agents'), context.require('activeSessions'), context.signal)
      context.provide('commands', commands)
      context.own(() => commands.dispose())
    }
  },
}

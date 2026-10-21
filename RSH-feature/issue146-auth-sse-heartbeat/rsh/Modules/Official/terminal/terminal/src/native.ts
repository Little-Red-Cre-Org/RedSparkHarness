/** Native owner-scoped terminal allocation, interaction and awaited cleanup. */
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { NativeAgent, NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import type {} from '@deepseek-ai/dsh-native-agent/native'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { Session } from '@deepseek-ai/dsh-session/native'
import type { TerminalBackendSession, TerminalReadRequest, TerminalReadResult, TerminalSendOperation, TerminalSendRequest, TerminalSignal, TerminalSignalResult } from './protocol.ts'

/** Opaque identity minted for one native terminal session. */
export type NativeTerminalId = Branded<'NativeTerminalId'>

/** Validate a model-supplied terminal identity before lookup.
 * @param value - untrusted terminal identifier.
 * @returns validated opaque identity.
 */
export function NativeTerminalId(value: string): NativeTerminalId {
  if (!/^pty-[1-9][0-9]*$/.test(value)) throw new Error('terminal: invalid session id')
  return brandString<NativeTerminalId>(value)
}

/** Terminal process retained by a selected backend until awaited close. */
export interface NativeTerminalSession {
  /** Zero while a provider has allocated a PTY but has not learned its process id. */
  readonly pid: number
  /** Interactive Provider retaining the shared PTY implementation, when supported. */
  readonly interaction?: TerminalBackendSession
  /** Top-level process state; this does not describe child commands. */
  status(): 'running' | 'exited' | 'failed'
  /** Terminate the process range visible to the selected Provider and await its cleanup. */
  close(): Promise<void>
}

/** Unpublished terminal allocation. */
export interface NativeTerminalSpawnSpec {
  readonly owner: NativeAgent
  readonly sessionId: NativeTerminalId
  readonly session: Session
  readonly cwd?: string
  readonly signal: AbortSignal
}

/** Replaceable implementation of one terminal type. */
export interface NativeTerminalBackend {
  readonly type: string
  /** Reject only after any partially allocated process has been cleaned. */
  spawn(spec: NativeTerminalSpawnSpec): Promise<NativeTerminalSession>
}

/** Visible facts for one exact Agent-owned terminal. */
export interface NativeTerminalSnapshot {
  readonly sessionId: NativeTerminalId
  readonly type: string
  /** Zero until an asynchronous terminal provider learns the process id. */
  readonly pid: number
  readonly status: 'running' | 'exited' | 'failed'
  readonly name?: string
  readonly motd?: string
}

interface BackendRegistration {
  readonly backend: NativeTerminalBackend
  readonly controller: AbortController
  readonly pending: Set<Promise<void>>
  removal?: Promise<void>
}

interface OwnerState {
  readonly names: Set<string>
  readonly controller: AbortController
  readonly pending: Set<Promise<void>>
  readonly detach: () => void
}

interface RecordEntry {
  readonly name?: string
  readonly owner: NativeAgent
  readonly backend: BackendRegistration
  readonly session: NativeTerminalSession
  closing?: Promise<void>
  active?: TerminalSendOperation
}

/** Native terminal registry; all open and close operations use exact Agent identity. */
export class NativeTerminalRegistry {
  private readonly backends = new Map<string, BackendRegistration>()
  private readonly owners = new Map<NativeAgent, OwnerState>()
  private readonly sessions = new Map<NativeTerminalId, RecordEntry>()
  private nextId = 0
  private closing = false
  private disposal?: Promise<void>

  /** @param agents - selected Agent registry for liveness and release cleanup. */
  constructor(private readonly agents: NativeAgentRegistry) {}

  /** Register one backend until its disposer closes its sessions and pending opens.
   * @param backend - selected terminal implementation.
   * @returns awaited deregistration.
   */
  registerBackend(backend: NativeTerminalBackend): () => Promise<void> {
    if (this.closing) throw new Error('terminal: registry is closing')
    if (backend.type.trim().length === 0) throw new Error('terminal: backend type must be nonempty')
    if (this.backends.has(backend.type)) throw new Error(`terminal: duplicate backend ${backend.type}`)
    const registration: BackendRegistration = { backend, controller: new AbortController(), pending: new Set() }
    this.backends.set(backend.type, registration)
    return () => registration.removal ??= (async () => {
      if (this.backends.get(backend.type) !== registration) return
      registration.controller.abort(new Error('terminal: backend removed'))
      await Promise.all(registration.pending)
      await this.closeRecords(record => record.backend === registration)
      this.backends.delete(backend.type)
    })()
  }

  /** Open a terminal, publishing it only after allocation and cancellation checks.
   * @param owner - exact live Agent.
   * @param session - Session whose sandbox policy applies to the process.
   * @param type - registered backend type.
   * @param cwd - optional explicit working directory.
   * @param signal - caller cancellation during allocation.
   * @param name - optional owner-local unique name.
   * @returns published terminal snapshot.
   */
  async open(owner: NativeAgent, session: Session, type: string, cwd?: string, signal?: AbortSignal,
    name?: string): Promise<NativeTerminalSnapshot> {
    if (this.closing) throw new Error('terminal: registry is closing')
    signal?.throwIfAborted()
    const registration = this.backends.get(type)
    if (registration === undefined) throw new Error(`terminal: no backend registered for ${type}`)
    const state = this.ownerState(owner)
    if (name !== undefined) {
      if (name.trim().length === 0) throw new Error('terminal: name must be nonempty')
      if (state.names.has(name)) throw new Error(`terminal: duplicate name ${name}`)
      state.names.add(name)
    }
    const pending = Promise.withResolvers<void>()
    state.pending.add(pending.promise)
    registration.pending.add(pending.promise)
    const allocationSignal = AbortSignal.any([
      state.controller.signal, registration.controller.signal, ...(signal === undefined ? [] : [signal]),
    ])
    const id = NativeTerminalId(`pty-${++this.nextId}`)
    let terminal: NativeTerminalSession | undefined
    try {
      allocationSignal.throwIfAborted()
      terminal = await registration.backend.spawn({
        owner, sessionId: id, session, ...(cwd === undefined ? {} : { cwd }), signal: allocationSignal,
      })
      allocationSignal.throwIfAborted()
      const record: RecordEntry = { owner, backend: registration, session: terminal, ...name === undefined ? {} : { name } }
      this.sessions.set(id, record)
      return this.snapshot(id, record)
    } catch (error) {
      if (name !== undefined) state.names.delete(name)
      if (terminal !== undefined) {
        try { await terminal.close() } catch (cleanup: unknown) {
          throw new AggregateError([error, cleanup], 'terminal: open and cleanup failed')
        }
      }
      throw error
    } finally {
      state.pending.delete(pending.promise)
      registration.pending.delete(pending.promise)
      pending.resolve()
    }
  }

  /** List terminal sessions belonging to the exact live Agent.
   * @param owner - exact registered Agent.
   * @returns detached snapshots in creation order.
   */
  list(owner: NativeAgent): NativeTerminalSnapshot[] {
    this.assertOwner(owner)
    return [...this.sessions].flatMap(([id, record]) => record.owner === owner ? [this.snapshot(id, record)] : [])
  }

  /** Close one owned terminal and await cleanup of the Provider-observed process range.
   * @param owner - exact registered Agent.
   * @param id - registry-issued identity.
   * @returns true when this call initiated close, false when it joined an in-flight close.
   */
  async close(owner: NativeAgent, id: NativeTerminalId): Promise<boolean> {
    this.assertOwner(owner)
    const record = this.sessions.get(id)
    if (record === undefined) throw new Error(`terminal: unknown session ${id}`)
    if (record.owner !== owner) throw new Error(`terminal: session ${id} belongs to another Agent`)
    const alreadyClosing = record.closing !== undefined
    await this.closeRecord(id, record)
    return !alreadyClosing
  }

  /** Start one exclusive interaction.
   * @param owner - exact live Agent.
   * @param id - owned terminal identity.
   * @param request - input, Enter selection and request cancellation.
   * @returns backend-owned operation; disposal interrupts and drains it.
   */
  startSend(owner: NativeAgent, id: NativeTerminalId, request: TerminalSendRequest): TerminalSendOperation {
    const record = this.owned(owner, id)
    if (record.active !== undefined) throw new Error(`terminal: send already active on ${id}`)
    const state = this.ownerState(owner)
    const signal = AbortSignal.any([state.controller.signal, record.backend.controller.signal,
      ...(request.signal === undefined ? [] : [request.signal])])
    signal.throwIfAborted()
    const operation = this.interaction(record).startSend({ ...request, signal })
    record.active = operation
    void operation.done.then(() => { delete record.active }, () => { delete record.active })
    return operation
  }

  /** Read retained output.
   * @param owner - exact live Agent.
   * @param id - owned terminal identity.
   * @param request - newest-relative page selection.
   * @returns bounded output and retention facts.
   */
  read(owner: NativeAgent, id: NativeTerminalId, request: TerminalReadRequest): TerminalReadResult {
    return this.interaction(this.owned(owner, id)).read(request)
  }

  /** Signal the verified foreground process group.
   * @param owner - exact live Agent.
   * @param id - owned terminal identity.
   * @param signal - allowed process signal.
   * @returns delivered target facts.
   */
  signal(owner: NativeAgent, id: NativeTerminalId, signal: TerminalSignal): Promise<TerminalSignalResult> {
    return this.interaction(this.owned(owner, id)).signal(signal)
  }

  private owned(owner: NativeAgent, id: NativeTerminalId): RecordEntry {
    this.assertOwner(owner)
    if (this.closing) throw new Error('terminal: registry is closing')
    const record = this.sessions.get(id)
    if (record === undefined) throw new Error(`terminal: unknown session ${id}`)
    if (record.owner !== owner) throw new Error(`terminal: session ${id} belongs to another Agent`)
    if (record.closing !== undefined) throw new Error(`terminal: session ${id} is closing`)
    return record
  }

  private interaction(record: RecordEntry): TerminalBackendSession {
    if (record.session.interaction === undefined) throw new Error('terminal: backend does not support interaction')
    return record.session.interaction
  }

  /** Abort unpublished opens and await every terminal before disposing the registry. */
  dispose(): Promise<void> {
    return this.disposal ??= this.disposeInternal()
  }

  private ownerState(owner: NativeAgent): OwnerState {
    this.assertOwner(owner)
    const existing = this.owners.get(owner)
    if (existing !== undefined) return existing
    const state: OwnerState = {
      names: new Set(), controller: new AbortController(), pending: new Set(),
      detach: this.agents.onDispose(owner, () => this.disposeOwner(owner)),
    }
    this.owners.set(owner, state)
    return state
  }

  private assertOwner(owner: NativeAgent): void {
    if (this.agents.get(owner.id) !== owner) throw new Error('terminal: Agent is not the registered owner')
  }

  private snapshot(id: NativeTerminalId, record: RecordEntry): NativeTerminalSnapshot {
    return { sessionId: id, type: record.backend.backend.type, pid: record.session.pid, status: record.session.status(),
      ...record.name === undefined ? {} : { name: record.name },
      ...record.session.interaction === undefined ? {} : { motd: record.session.interaction.motd },
    }
  }

  private async closeRecord(id: NativeTerminalId, record: RecordEntry): Promise<void> {
    const closing = record.closing ??= record.session.close()
    try {
      await closing
      this.sessions.delete(id)
      if (record.name !== undefined) this.owners.get(record.owner)?.names.delete(record.name)
    } catch (error) {
      if (record.closing === closing) delete record.closing
      throw error
    }
  }

  private async closeRecords(select: (record: RecordEntry) => boolean): Promise<void> {
    const results = await Promise.allSettled([...this.sessions].filter(([, record]) => select(record))
      .map(([id, record]) => this.closeRecord(id, record)))
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    if (failures.length > 0) throw new AggregateError(failures, 'terminal: cleanup failed')
  }

  private async disposeOwner(owner: NativeAgent): Promise<void> {
    const state = this.owners.get(owner)
    if (state === undefined) return
    state.controller.abort(new Error('terminal: Agent disposed'))
    await Promise.all(state.pending)
    await this.closeRecords(record => record.owner === owner)
    state.detach()
    this.owners.delete(owner)
  }

  private async disposeInternal(): Promise<void> {
    this.closing = true
    for (const backend of this.backends.values()) backend.controller.abort(new Error('terminal: registry disposed'))
    const results = await Promise.allSettled([...this.owners].map(([owner]) => this.disposeOwner(owner)))
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    if (failures.length > 0) throw new AggregateError(failures, 'terminal: disposal failed')
    this.backends.clear()
  }
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { terminals: NativeTerminalRegistry }
}

/** Install one registry with Agent release and Host teardown ownership. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-terminal', targets: ['host'],
  requires: ['agents'], provides: ['terminals'],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input)
      || Object.keys(input).length !== 0)) throw new Error('terminal: native configuration must be empty')
    return (context) => {
      const registry = new NativeTerminalRegistry(context.require('agents'))
      context.own(() => registry.dispose())
      context.provide('terminals', registry)
    }
  },
}

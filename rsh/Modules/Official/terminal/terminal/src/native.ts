/** Native owner-scoped terminal lifecycle without interactive send or read operations. */
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { NativeAgent, NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import type {} from '@deepseek-ai/dsh-native-agent/native'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { Session } from '@deepseek-ai/dsh-session/native'

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
  /** Top-level process state; this does not describe child commands. */
  status(): 'running' | 'exited' | 'failed'
  /** Terminate the process range visible to the selected Provider and await its cleanup. */
  close(): Promise<void>
}

/** Unpublished terminal allocation. */
export interface NativeTerminalSpawnSpec {
  readonly owner: NativeAgent
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
}

interface BackendRegistration {
  readonly backend: NativeTerminalBackend
  readonly controller: AbortController
  readonly pending: Set<Promise<void>>
  removal?: Promise<void>
}

interface OwnerState {
  readonly controller: AbortController
  readonly pending: Set<Promise<void>>
  readonly detach: () => void
}

interface RecordEntry {
  readonly owner: NativeAgent
  readonly backend: BackendRegistration
  readonly session: NativeTerminalSession
  closing?: Promise<void>
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
   * @returns published terminal snapshot.
   */
  async open(owner: NativeAgent, session: Session, type: string, cwd?: string, signal?: AbortSignal): Promise<NativeTerminalSnapshot> {
    if (this.closing) throw new Error('terminal: registry is closing')
    signal?.throwIfAborted()
    const registration = this.backends.get(type)
    if (registration === undefined) throw new Error(`terminal: no backend registered for ${type}`)
    const state = this.ownerState(owner)
    const pending = Promise.withResolvers<void>()
    state.pending.add(pending.promise)
    registration.pending.add(pending.promise)
    const allocationSignal = AbortSignal.any([
      state.controller.signal, registration.controller.signal, ...(signal === undefined ? [] : [signal]),
    ])
    let terminal: NativeTerminalSession | undefined
    try {
      allocationSignal.throwIfAborted()
      terminal = await registration.backend.spawn({ owner, session, ...(cwd === undefined ? {} : { cwd }), signal: allocationSignal })
      allocationSignal.throwIfAborted()
      const id = NativeTerminalId(`pty-${++this.nextId}`)
      const record: RecordEntry = { owner, backend: registration, session: terminal }
      this.sessions.set(id, record)
      return this.snapshot(id, record)
    } catch (error) {
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

  /** Abort unpublished opens and await every terminal before disposing the registry. */
  dispose(): Promise<void> {
    return this.disposal ??= this.disposeInternal()
  }

  private ownerState(owner: NativeAgent): OwnerState {
    this.assertOwner(owner)
    const existing = this.owners.get(owner)
    if (existing !== undefined) return existing
    const state: OwnerState = {
      controller: new AbortController(), pending: new Set(),
      detach: this.agents.onDispose(owner, () => this.disposeOwner(owner)),
    }
    this.owners.set(owner, state)
    return state
  }

  private assertOwner(owner: NativeAgent): void {
    if (this.agents.get(owner.id) !== owner) throw new Error('terminal: Agent is not the registered owner')
  }

  private snapshot(id: NativeTerminalId, record: RecordEntry): NativeTerminalSnapshot {
    return { sessionId: id, type: record.backend.backend.type, pid: record.session.pid, status: record.session.status() }
  }

  private async closeRecord(id: NativeTerminalId, record: RecordEntry): Promise<void> {
    const closing = record.closing ??= record.session.close()
    try {
      await closing
      this.sessions.delete(id)
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

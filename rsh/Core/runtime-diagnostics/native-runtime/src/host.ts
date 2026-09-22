/** Explicit installation planning and native activation without a framework adapter. */
import { RuntimeEvents, type EventKey, type EventListener } from './events.ts'
import { NativeScope, ResourceOwner, type Disposer, type NativeScopeId } from './scope.ts'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Extend in service Definition packages with the capability name and its interface. */
export interface NativeServices {}

type ServiceKey = keyof NativeServices

/** One resolved activation's owned capabilities and cancellation. */
export interface NativeContext {
  readonly scope: NativeScope
  readonly signal: AbortSignal
  readonly events: Pick<RuntimeEvents, 'emit' | 'serial' | 'parallel' | 'waterfall'>
  /**
   * Subscribe with this installation as owner and scope as visibility root.
   * @param key - declared event name.
   * @param listener - callback following the event's mode.
   * @returns an idempotent, awaitable unsubscribe operation.
   */
  on<K extends EventKey>(key: K, listener: EventListener<K>): () => Promise<void>
  /**
   * Read a declared required capability; only ready providers are visible.
   * @param key - capability listed in the plugin's requires declaration.
   * @returns the selected provider's service.
   */
  require<K extends ServiceKey>(key: K): NativeServices[K]
  /**
   * Read an explicitly optional capability without treating absence as failure.
   * @param key - capability listed in the plugin's optional declaration.
   * @returns the selected service, or undefined when the plan contains no provider.
   */
  optional<K extends ServiceKey>(key: K): NativeServices[K] | undefined
  /**
   * Stage a capability until activation succeeds.
   * @param key - capability listed in the plugin's provides declaration.
   * @param service - service exclusively owned by this activation.
   */
  provide<K extends ServiceKey>(key: K, service: NativeServices[K]): void
  /**
   * Own a resource immediately after acquiring it; usable until activation settles.
   * @param dispose - awaitable resource release.
   * @returns idempotent early release with the same completion as host cleanup.
   */
  own(dispose: Disposer): () => Promise<void>
}

/** Native execution protocol revision 1; independent of dsh.runtime role metadata. */
export interface NativePlugin {
  readonly apiVersion: number
  readonly name: string
  readonly targets: readonly ('host' | 'client')[]
  readonly requires: readonly ServiceKey[]
  readonly optional?: readonly ServiceKey[]
  readonly provides: readonly ServiceKey[]
  /**
   * Validate explicit configuration without activating resources.
   * @param input - configuration from the installation request.
   * @returns the activation configured with a validated specification.
   */
  resolve(input: unknown): (context: NativeContext) => void | Promise<void>
}

/** Explicit selection of a plugin and its resource visibility scope. */
export interface InstallationRequest {
  readonly plugin: NativePlugin
  readonly scope: NativeScope
  readonly config: unknown
}

interface PlannedInstallation {
  id: NativeInstallationId
  request: InstallationRequest
  name: string
  scope: NativeScope
  provides: readonly ServiceKey[]
  requires: readonly ServiceKey[]
  optional: readonly ServiceKey[]
  dependencies: ReadonlyMap<ServiceKey, PlannedInstallation>
  activate: (context: NativeContext) => void | Promise<void>
}

/** Opaque identity for one planned installation, independent of its plugin name. */
export type NativeInstallationId = Branded<'NativeInstallationId'>

/** Configuration-free observation of one installation and its selected dependencies. */
export interface InstallationDiagnostic {
  readonly id: NativeInstallationId
  readonly name: string
  readonly scope: NativeScopeId
  readonly state: 'planned' | 'activating' | 'ready' | 'draining' | 'failed' | 'disposed'
  readonly dependencies: readonly { service: ServiceKey; provider: NativeInstallationId }[]
  readonly failure: 'activation' | 'cleanup' | undefined
  readonly cleanup: 'pending' | 'complete' | 'failed'
}

/** Explicit execution actor captured for one admitted operation. */
export interface NativeInvocation<Actor extends object> {
  readonly initiator: Actor
  readonly scope: NativeScope
  readonly signal: AbortSignal
}

const planEntries = Symbol('native installation plan')

/** Opaque, single-composition activation plan; only the resolver can create one. */
export class InstallationPlan {
  readonly [planEntries]: readonly PlannedInstallation[]
  private constructor(entries: readonly PlannedInstallation[]) {
    this[planEntries] = entries
  }

  /**
   * Resolve every dependency before any activation is permitted.
   * @param requests - explicitly selected plugins, scopes, and configurations.
   * @param target - compilation/runtime target selected by the application.
   * @returns a dependency-ordered plan with copied declarations.
   */
  static resolve(requests: readonly InstallationRequest[], target: 'host' | 'client'): InstallationPlan {
    if (new Set(requests).size !== requests.length) {
      throw new Error('native-runtime: duplicate installation request')
    }
    const selected = requests.map((request) => {
      const { plugin, scope, config } = request
      if (plugin.apiVersion !== 1) throw new Error(`native-runtime: ${plugin.name} has unsupported API version`)
      if (!plugin.targets.includes(target)) throw new Error(`native-runtime: ${plugin.name} does not support ${target}`)
      return { plugin, scope, config, request }
    })
    const entries = selected.map(({ plugin, scope, config, request }): PlannedInstallation & { plugin: NativePlugin; config: unknown } => ({
      id: brandString<NativeInstallationId>(globalThis.crypto.randomUUID()),
      plugin, config, request, optional: [...plugin.optional ?? []], requires: [...plugin.requires],
      name: plugin.name, scope, provides: [...plugin.provides], dependencies: new Map<ServiceKey, PlannedInstallation>(),
      activate: () => { throw new Error('native-runtime: unresolved activation') },
    }))
    for (const entry of entries) {
      const seen = new Set<ServiceKey>()
      for (const key of entry.provides) {
        if (seen.has(key) || entries.some(other => other !== entry && other.scope === entry.scope && other.provides.includes(key))) {
          throw new Error(`native-runtime: duplicate provider for ${String(key)} in ${entry.name}'s scope`)
        }
        seen.add(key)
      }
    }
    entries.forEach((entry) => {
      for (const key of [...entry.requires, ...entry.optional]) {
        let provider: PlannedInstallation | undefined
        for (let scope: NativeScope | undefined = entry.scope; scope !== undefined; scope = scope.parent) {
          provider = entries.find(other => other.scope === scope && other.provides.includes(key))
          if (provider !== undefined) break
        }
        if (provider === undefined) {
          if (entry.optional.includes(key) && !entry.requires.includes(key)) continue
          throw new Error(`native-runtime: ${entry.name} requires missing ${String(key)}`)
        }
        ;(entry.dependencies as Map<ServiceKey, PlannedInstallation>).set(key, provider)
      }
    })
    const ordered: PlannedInstallation[] = []
    const visiting = new Set<PlannedInstallation>()
    const visited = new Set<PlannedInstallation>()
    const visit = (entry: PlannedInstallation): void => {
      if (visiting.has(entry)) throw new Error(`native-runtime: dependency cycle at ${entry.name}`)
      if (visited.has(entry)) return
      visiting.add(entry)
      for (const dependency of entry.dependencies.values()) visit(dependency)
      visiting.delete(entry)
      visited.add(entry)
      ordered.push(entry)
    }
    entries.forEach(visit)
    entries.forEach((entry) => { entry.activate = entry.plugin.resolve(entry.config) })
    return new InstallationPlan(ordered)
  }
}

/**
 * Validate and order an explicit installation without creating services.
 * @param requests - chosen plugins and configurations.
 * @param target - host or client execution target.
 * @returns an opaque activation plan.
 */
export function resolveInstallation(requests: readonly InstallationRequest[], target: 'host' | 'client'): InstallationPlan {
  return InstallationPlan.resolve(requests, target)
}

interface Activation {
  entry: PlannedInstallation
  owner: ResourceOwner
  services: Map<ServiceKey, unknown>
}

/** Starts one resolved composition and awaits owned resource cleanup on failure or stop. */
export class NativeHost {
  /** Host-owned event dispatch; plugin subscriptions are owned through NativeContext.on. */
  readonly events = new RuntimeEvents()
  private readonly activations: Activation[] = []
  private readonly ready = new Map<PlannedInstallation, Activation>()
  private readonly diagnosticState = new Map<PlannedInstallation, Pick<InstallationDiagnostic, 'state' | 'failure' | 'cleanup'>>()
  private readonly controller = new AbortController()
  private readonly invocations = new Set<Promise<unknown>>()
  private started = false
  private startup: Promise<void> | undefined
  private shutdown: Promise<void> | undefined
  private mutation: Promise<void> = Promise.resolve()

  /** @param plan - validated composition; the host has no implicit providers. */
  constructor(private readonly plan: InstallationPlan) {
    for (const entry of plan[planEntries]) {
      this.diagnosticState.set(entry, { state: 'planned', failure: undefined, cleanup: 'pending' })
    }
  }

  /**
   * Snapshot installation state without configuration values or failure messages.
   * @returns detached observations in dependency order.
   */
  diagnostics(): readonly InstallationDiagnostic[] {
    return this.plan[planEntries].map((entry) => {
      const current = this.diagnosticState.get(entry)
      if (current === undefined) throw new Error('native-runtime: missing installation diagnostic')
      return {
        id: entry.id, name: entry.name, scope: entry.scope.id, ...current,
        dependencies: [...entry.dependencies].map(([service, provider]) => ({ service, provider: provider.id })),
      }
    })
  }

  /**
   * Keep each concurrent caller's initiator explicit and drain admitted work on stop.
   * @param scope - capability visibility for this operation.
   * @param initiator - Agent or tool execution that started the operation.
   * @param work - operation that retains the invocation across asynchronous calls.
   * @returns the caller-owned result after the operation settles.
   */
  run<Actor extends object, Result>(
    scope: NativeScope, initiator: Actor, work: (invocation: NativeInvocation<Actor>) => Result | Promise<Result>,
  ): Promise<Result> {
    if (this.startup === undefined) return Promise.reject(new Error('native-runtime: host has not started'))
    if (this.controller.signal.aborted) return Promise.reject(new Error('native-runtime: host stopped'))
    const invocation = { scope, initiator, signal: this.controller.signal }
    const task = Promise.resolve().then(() => {
      invocation.signal.throwIfAborted()
      if (!this.started) throw new Error('native-runtime: host is not ready')
      return work(invocation)
    })
    this.invocations.add(task)
    void task.then(() => this.invocations.delete(task), () => this.invocations.delete(task))
    return task
  }

  /**
   * Activate dependencies first. Failed startup awaits rollback before rejecting.
   * @returns shared startup completion; starting a stopped host rejects.
   */
  start(): Promise<void> {
    if (this.controller.signal.aborted) return Promise.reject(new Error('native-runtime: host stopped'))
    return this.startup ??= Promise.resolve().then(async () => {
      try {
        for (const entry of this.plan[planEntries]) {
          this.controller.signal.throwIfAborted()
          const owner = new ResourceOwner()
          const services = new Map<ServiceKey, unknown>()
          const activation = { entry, owner, services }
          this.activations.push(activation)
          this.diagnosticState.set(entry, { state: 'activating', failure: undefined, cleanup: 'pending' })
          const context: NativeContext = {
            scope: entry.scope, signal: owner.controller.signal, events: this.events,
            own: dispose => owner.own(dispose),
            on: (key, listener) => {
              owner.controller.signal.throwIfAborted()
              const off = this.events.on(entry.scope, key, listener)
              const cancel = () => { owner.waitFor(off()) }
              owner.controller.signal.addEventListener('abort', cancel, { once: true })
              return owner.own(() => {
                owner.controller.signal.removeEventListener('abort', cancel)
                return off()
              })
            },
            require: <K extends ServiceKey>(key: K): NativeServices[K] => {
              owner.controller.signal.throwIfAborted()
              const dependency = entry.dependencies.get(key)
              const provider = dependency === undefined ? undefined : this.ready.get(dependency)
              if (!entry.requires.includes(key) || provider === undefined || !provider.services.has(key)) {
                throw new Error(`native-runtime: ${entry.name} cannot read undeclared or unavailable ${String(key)}`)
              }
              return provider.services.get(key) as NativeServices[K]
            },
            optional: <K extends ServiceKey>(key: K): NativeServices[K] | undefined => {
              owner.controller.signal.throwIfAborted()
              if (!entry.optional.includes(key)) {
                throw new Error(`native-runtime: ${entry.name} did not declare optional ${String(key)}`)
              }
              const dependency = entry.dependencies.get(key)
              if (dependency === undefined) return undefined
              const provider = this.ready.get(dependency)
              if (provider === undefined) throw new Error(`native-runtime: selected optional ${String(key)} is unavailable`)
              return provider.services.get(key) as NativeServices[K]
            },
            provide: (key, service) => {
              owner.controller.signal.throwIfAborted()
              if (this.ready.has(entry) || !entry.provides.includes(key) || services.has(key)) {
                throw new Error(`native-runtime: ${entry.name} cannot publish ${String(key)}`)
              }
              services.set(key, service)
            },
          }
          await entry.activate(context)
          this.controller.signal.throwIfAborted()
          for (const key of entry.provides) {
            if (!services.has(key)) throw new Error(`native-runtime: ${entry.name} did not provide ${String(key)}`)
          }
          this.ready.set(entry, activation)
          this.diagnosticState.set(entry, { state: 'ready', failure: undefined, cleanup: 'pending' })
        }
        this.started = true
      } catch (error) {
        for (const activation of this.activations) {
          const current = this.diagnosticState.get(activation.entry)
          if (current?.state === 'activating') {
            this.diagnosticState.set(activation.entry, { ...current, state: 'failed', failure: 'activation' })
          }
        }
        this.controller.abort(error)
        try { await this.release() } catch (cleanup) {
          throw new AggregateError([error, cleanup], 'native-runtime: activation and rollback failed')
        }
        throw error
      }
    })
  }

  private async release(activations = [...this.activations], closeEvents = true): Promise<void> {
    const errors: unknown[] = []
    for (const activation of activations) {
      const current = this.diagnosticState.get(activation.entry)
      if (current?.state !== 'failed') this.diagnosticState.set(activation.entry, { ...current, state: 'draining', failure: current?.failure, cleanup: 'pending' })
      activation.owner.controller.abort()
    }
    if (closeEvents) await this.events.close()
    for (const activation of [...activations].reverse()) {
      this.ready.delete(activation.entry)
      try {
        await activation.owner.dispose()
        const current = this.diagnosticState.get(activation.entry)
        this.diagnosticState.set(activation.entry, { state: current?.state === 'failed' ? 'failed' : 'disposed', failure: current?.failure, cleanup: 'complete' })
      } catch (error) {
        errors.push(error)
        this.diagnosticState.set(activation.entry, { state: 'failed', failure: 'cleanup', cleanup: 'failed' })
      }
      activation.services.clear()
      this.activations.splice(this.activations.indexOf(activation), 1)
    }
    if (errors.length > 0) throw new AggregateError(errors, 'native-runtime: composition cleanup failed')
  }

  /**
   * Stop one installation and its transitive consumers, leaving unrelated owners active.
   * Await removal from outside the affected callbacks; a callback cannot await its own drain.
   * @param request - the original request object supplied to resolveInstallation.
   * @returns completion after affected callbacks and resources settle; unknown requests reject.
   */
  remove(request: InstallationRequest): Promise<void> {
    const operation = this.mutation.then(async () => {
      await this.startup
      this.controller.signal.throwIfAborted()
      const entry = this.plan[planEntries].find(candidate => candidate.request === request)
      if (entry === undefined) throw new Error('native-runtime: installation request does not belong to this host')
      if (this.startup === undefined) throw new Error('native-runtime: host has not started')
      const removed = new Set([entry])
      for (const activation of this.activations) {
        if ([...activation.entry.dependencies.values()].some(dependency => removed.has(dependency))) {
          removed.add(activation.entry)
        }
      }
      await this.release(this.activations.filter(activation => removed.has(activation.entry)), false)
    })
    // The caller owns this operation's error; later mutations still need to reach remaining owners.
    this.mutation = operation.catch(() => undefined)
    return operation
  }

  /**
   * Stop admission immediately, await startup settlement, then release dependents before providers.
   * Await stop from outside admitted work; an operation cannot await its own drain.
   * @returns shared shutdown completion, including any startup or cleanup failure.
   */
  stop(): Promise<void> {
    this.controller.abort()
    for (const activation of this.activations) activation.owner.controller.abort()
    const draining = this.events.close()
    return this.shutdown ??= Promise.resolve().then(async () => {
      await draining
      await this.startup
      await this.mutation
      await Promise.allSettled(this.invocations)
      await this.release()
      for (const [entry, current] of this.diagnosticState) {
        if (current.state === 'planned') {
          this.diagnosticState.set(entry, { state: 'disposed', failure: undefined, cleanup: 'complete' })
        }
      }
    })
  }
}

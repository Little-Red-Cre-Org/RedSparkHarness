/** Cordis-free settings definition shared by native providers and consumers. */
import { deepEqualJson, deepFreeze, snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import type {} from '@deepseek-ai/dsh-native-runtime'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { settings: NativeSettings }
}

/** One namespace's raw user overrides. */
export type NativeSettingsSection = Record<string, unknown>

/** Storage commits a complete document against its latest durable revision. */
export interface NativeSettingsStorage {
  load(): Promise<NativeSettingsSection>
  persist(update: (document: NativeSettingsSection) => NativeSettingsSection): Promise<NativeSettingsSection>
}

/** A resolved namespace owner, with writes restricted to its own user section. */
export interface NativeSettingsScope<T> {
  get(): T
  readonly revision: number
  update(patch: NativeSettingsSection, expectedRevision?: number): Promise<void>
  replace(section: NativeSettingsSection, expectedRevision?: number): Promise<void>
  watch(callback: (next: T, previous: T) => void): () => void
  dispose(): void
}

interface Registration<T> {
  readonly namespace: string
  readonly base: NativeSettingsSection
  readonly resolve: (value: NativeSettingsSection) => T
  readonly validateWrite?: (next: T, previous: T) => void
  readonly listeners: Set<(next: T, previous: T) => void>
  section: NativeSettingsSection
  value: T
  revision: number
  active: boolean
}

/** A stale optimistic write leaves the durable document unchanged. */
export class NativeSettingsConflictError extends Error {
  /** Stable code for an optimistic revision conflict. */
  readonly code = 'SETTINGS_CONFLICT'
  constructor(readonly namespace: string, readonly expected: number, readonly actual: number) {
    super(`settings namespace "${namespace}" changed (expected revision ${expected}, now ${actual})`)
  }
}

/** Owns namespace resolution, ordered writes and reloads for one native Host. */
export class NativeSettings {
  private document: NativeSettingsSection = {}
  private readonly registrations = new Map<string, Registration<unknown>>()
  private tail: Promise<void> = Promise.resolve()
  private started = false
  private closed = false

  constructor(private readonly storage: NativeSettingsStorage) {}

  /** Load the complete document before any consumer registers. */
  async start(): Promise<void> {
    if (this.started || this.closed) throw new Error('settings service cannot start twice')
    this.document = section(await this.storage.load())
    this.started = true
  }

  /**
   * Register a namespace with its composition base and validating resolver.
   * @param namespace - lowercase owner id in the settings document.
   * @param base - composition values below user overrides.
   * @param resolve - validator and default resolver for the merged value.
   * @param validateWrite - optional check of a proposed user write against the current value.
   * @returns the owner scope, which must be disposed with its installation.
   */
  register<T>(namespace: string, base: NativeSettingsSection, resolve: (value: NativeSettingsSection) => T,
    validateWrite?: (next: T, previous: T) => void): NativeSettingsScope<T> {
    this.assertReady()
    if (this.closed) throw new Error('settings service is disposed')
    if (!/^[a-z][a-z0-9-]*$/.test(namespace)) throw new TypeError(`invalid settings namespace "${namespace}"`)
    if (this.registrations.has(namespace)) throw new Error(`settings namespace "${namespace}" is already registered`)
    const stored = section(this.document[namespace])
    const registration: Registration<T> = {
      namespace, base: section(base), resolve, ...validateWrite === undefined ? {} : { validateWrite }, section: stored,
      value: resolved(resolve, merge(base, stored)), revision: 0, active: true, listeners: new Set(),
    }
    this.registrations.set(namespace, registration as Registration<unknown>)
    return {
      get: () => {
        if (!registration.active) throw new Error('settings registration is disposed')
        return registration.value
      },
      get revision() {
        if (!registration.active) throw new Error('settings registration is disposed')
        return registration.revision
      },
      update: (patch, expectedRevision) => this.write(registration, patch, false, expectedRevision),
      replace: (replacement, expectedRevision) => this.write(registration, replacement, true, expectedRevision),
      watch: (callback) => {
        if (!registration.active) throw new Error('settings registration is disposed')
        registration.listeners.add(callback)
        return () => registration.listeners.delete(callback)
      },
      dispose: () => {
        registration.active = false
        registration.listeners.clear()
        if (this.registrations.get(namespace) === registration) this.registrations.delete(namespace)
      },
    }
  }

  /** Publish valid external changes; invalid registered sections retain their last good value. */
  reload(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('settings service is disposed'))
    return this.enqueue(async () => {
      this.assertReady()
      this.apply(section(await this.storage.load()))
    })
  }

  /** Refuse new work and drain accepted operations before Host teardown. */
  async dispose(): Promise<void> {
    this.closed = true
    await this.tail
    for (const registration of this.registrations.values()) {
      registration.active = false
      registration.listeners.clear()
    }
    this.registrations.clear()
  }

  private write<T>(registration: Registration<T>, input: NativeSettingsSection,
    replace: boolean, expectedRevision?: number): Promise<void> {
    if (this.closed) return Promise.reject(new Error('settings service is disposed'))
    const detached = section(input)
    return this.enqueue(async () => {
      this.assertReady()
      if (!registration.active) throw new Error('settings registration is disposed')
      if (expectedRevision !== undefined && expectedRevision !== registration.revision) {
        throw new NativeSettingsConflictError(registration.namespace, expectedRevision, registration.revision)
      }
      const committed = await this.storage.persist((current) => {
        const document = section(current)
        const next = replace ? detached : merge(section(document[registration.namespace]), detached)
        const nextValue = resolved(registration.resolve, merge(registration.base, next))
        registration.validateWrite?.(nextValue, registration.value)
        setOwn(document, registration.namespace, next)
        return document
      })
      this.apply(section(committed), registration.namespace)
    })
  }

  private apply(document: NativeSettingsSection, strictNamespace?: string): void {
    for (const registration of this.registrations.values()) {
      if (!registration.active) continue
      let nextSection: NativeSettingsSection
      let next: unknown
      try {
        nextSection = section(document[registration.namespace])
        if (deepEqualJson(registration.section, nextSection)) continue
        next = resolved(registration.resolve, merge(registration.base, nextSection))
      }
      catch (error) {
        if (strictNamespace === registration.namespace) throw error
        console.warn(`settings: invalid stored section for namespace "${registration.namespace}"`)
        continue
      }
      const previous = registration.value
      registration.section = nextSection
      registration.value = next
      registration.revision += 1
      if (!deepEqualJson(previous, next)) {
        for (const listener of registration.listeners) {
          try { listener(next, previous) }
          catch { console.warn(`settings: change listener failed for namespace "${registration.namespace}"`) }
        }
      }
    }
    this.document = document
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.tail.then(operation)
    this.tail = result.catch(() => undefined)
    return result
  }

  private assertReady(): void {
    if (!this.started) throw new Error('settings service has not started')
  }
}

function section(value: unknown): NativeSettingsSection {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('settings section must be an object')
  const snapshot = snapshotJsonValue(value)
  if (snapshot === undefined || typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
    throw new TypeError('settings section must contain JSON values')
  }
  return snapshot as NativeSettingsSection
}

function resolved<T>(resolver: (value: NativeSettingsSection) => T, value: NativeSettingsSection): T {
  const snapshot = snapshotJsonValue(resolver(value))
  if (snapshot === undefined) throw new TypeError('resolved settings must contain JSON values')
  return deepFreeze(snapshot) as T
}

function merge(base: NativeSettingsSection, patch: NativeSettingsSection): NativeSettingsSection {
  const result = section(base)
  for (const [key, value] of Object.entries(patch)) {
    const previous = result[key]
    setOwn(result, key, typeof previous === 'object' && previous !== null && !Array.isArray(previous)
      && typeof value === 'object' && value !== null && !Array.isArray(value)
      ? merge(section(previous), section(value)) : value)
  }
  return result
}

function setOwn(target: NativeSettingsSection, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true })
}

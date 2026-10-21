/** Cordis-free settings definition shared by native providers and consumers. */
import { deepEqualJson, deepFreeze, snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import type z from '@deepseek-ai/schemastery'
import { redactSecrets } from './redact.ts'

import type {} from '@deepseek-ai/dsh-settings-definition/native'
import type {
  NativeSettingsDescriptor,
  NativeSettingsPathOp,
  NativeSettingsPresentation,
  NativeSettingsScope,
  NativeSettingsSection,
  NativeSettingsService,
  NativeSettingsStorage,
  SettingsNamespaceInput,
} from '@deepseek-ai/dsh-settings-definition/native'

export type {
  NativeSettingsDescriptor,
  NativeSettingsPathOp,
  NativeSettingsPresentation,
  NativeSettingsScope,
  NativeSettingsSection,
  NativeSettingsService,
  NativeSettingsStorage,
  SettingsNamespaceInput,
} from '@deepseek-ai/dsh-settings-definition/native'

interface NativeSettingsWatcher<T> {
  callback: (next: T, previous: T) => void | Promise<void>
  tail: Promise<void>
  active: boolean
}

interface Registration<T> {
  readonly namespace: string
  readonly base: NativeSettingsSection
  readonly resolve: (value: NativeSettingsSection) => T
  readonly validateWrite?: (next: T, previous: T) => void
  readonly presentation?: NativeSettingsPresentation
  readonly listeners: Set<NativeSettingsWatcher<T>>
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
export class NativeSettings implements NativeSettingsService {
  private document: NativeSettingsSection = {}
  private readonly registrations = new Map<string, Registration<unknown>>()
  private readonly pendingNotifications = new Set<Promise<void>>()
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
   * @param presentation - optional schema and timing metadata for native configuration surfaces.
   * @returns the owner scope, which must be disposed with its installation.
   */
  register<const Namespace extends string, T>(
    namespace: Namespace & SettingsNamespaceInput<Namespace>,
    base: NativeSettingsSection, resolve: (value: NativeSettingsSection) => T,
    validateWrite?: (next: T, previous: T) => void, presentation?: NativeSettingsPresentation): NativeSettingsScope<T> {
    this.assertReady()
    if (this.closed) throw new Error('settings service is disposed')
    if (!/^[a-z][a-z0-9-]*$/.test(namespace)) throw new TypeError(`invalid settings namespace "${namespace}"`)
    if (this.registrations.has(namespace)) throw new Error(`settings namespace "${namespace}" is already registered`)
    if (presentation !== undefined && hasUnsupportedSecret(presentation.schema as unknown as SchemaNode)) {
      throw new TypeError('native settings presentation requires secret fields to use object, dict, or array paths')
    }
    const stored = section(this.document[namespace])
    const registration: Registration<T> = {
      namespace, base: section(base), resolve, ...validateWrite === undefined ? {} : { validateWrite },
      ...presentation === undefined ? {} : { presentation }, section: stored,
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
      update: (patch, expectedRevision) => this.write(registration, patch, 'merge', expectedRevision),
      replace: (replacement, expectedRevision) => this.write(registration, replacement, 'replace', expectedRevision),
      watch: (callback) => {
        if (!registration.active) throw new Error('settings registration is disposed')
        const watcher: NativeSettingsWatcher<T> = { callback, tail: Promise.resolve(), active: true }
        registration.listeners.add(watcher)
        return () => {
          watcher.active = false
          registration.listeners.delete(watcher)
        }
      },
      dispose: () => {
        registration.active = false
        for (const watcher of registration.listeners) watcher.active = false
        registration.listeners.clear()
        if (this.registrations.get(namespace) === registration) this.registrations.delete(namespace)
      },
    }
  }

  /** Describe only registrations that explicitly publish a schema for configuration UI.
   * @returns redacted views for the active exposed registrations.
   */
  describe(): NativeSettingsDescriptor[] {
    return [...this.registrations.values()].flatMap((registration) => {
      const presentation = registration.presentation
      if (!registration.active || presentation === undefined) return []
      const schema = presentation.schema as unknown as z<never>
      const value = redactSecrets(schema, registration.value)
      const base = redactSecrets(schema, registration.base).value
      const user = redactSecrets(schema, registration.section).value
      return [{
        namespace: registration.namespace,
        schema: stripSchemaDefaults(presentation.schema.toJSON()),
        value: value.value,
        base,
        user,
        applies: presentation.applies ?? 'live',
        secrets: value.secrets,
        credentialRefs: credentialRefs(schema, registration.value),
        revision: registration.revision,
      }]
    })
  }

  /** Apply schema-owner-validated path changes against one observed revision; array paths use existing numeric indices.
   * @param namespace - registered namespace to edit.
   * @param ops - ordered path edits.
   * @param expectedRevision - revision the caller observed.
   * @returns completion after storage and the live registration update.
   * @throws {@link NativeSettingsConflictError} when the revision is stale.
   * @throws {TypeError} when a path creates an array gap or removes an array entry.
   */
  mutate<const Namespace extends string>(
    namespace: Namespace & SettingsNamespaceInput<Namespace>,
    ops: readonly NativeSettingsPathOp[], expectedRevision: number,
  ): Promise<void> {
    const registration = this.registrations.get(namespace)
    if (registration === undefined) return Promise.reject(new Error(`settings namespace "${namespace}" is not registered`))
    if (registration.presentation === undefined) return Promise.reject(new Error(`settings namespace "${namespace}" is not published for native editing`))
    const detached = snapshotPathOps(ops)
    const schema = registration.presentation.schema as unknown as SchemaNode
    if (detached.some(op => touchesSecret(schema, op.path))) {
      return Promise.reject(new Error(`settings namespace "${namespace}" secret fields cannot be edited through native Settings`))
    }
    return this.write(registration, detached, 'mutate', expectedRevision)
  }

  /** Publish valid external changes; invalid registered sections retain their last good value. */
  reload(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('settings service is disposed'))
    return this.enqueue(async () => {
      this.assertReady()
      this.apply(section(await this.storage.load()))
    })
  }

  /** Refuse new work and drain accepted operations and started observers before Host teardown. */
  async dispose(): Promise<void> {
    this.closed = true
    await this.tail
    await Promise.all(this.pendingNotifications)
    for (const registration of this.registrations.values()) {
      registration.active = false
      for (const watcher of registration.listeners) watcher.active = false
      registration.listeners.clear()
    }
    this.registrations.clear()
  }

  private write<T>(registration: Registration<T>, input: NativeSettingsSection | readonly NativeSettingsPathOp[],
    mode: 'merge' | 'replace' | 'mutate', expectedRevision?: number): Promise<void> {
    if (this.closed) return Promise.reject(new Error('settings service is disposed'))
    const detached = mode === 'mutate' ? input as readonly NativeSettingsPathOp[] : section(input)
    return this.enqueue(async () => {
      this.assertReady()
      if (!registration.active) throw new Error('settings registration is disposed')
      if (expectedRevision !== undefined && expectedRevision !== registration.revision) {
        throw new NativeSettingsConflictError(registration.namespace, expectedRevision, registration.revision)
      }
      const committed = await this.storage.persist((current) => {
        const document = section(current)
        const stored = section(document[registration.namespace])
        const next = mode === 'replace' ? detached as NativeSettingsSection
          : mode === 'merge' ? merge(stored, detached as NativeSettingsSection)
            : (detached as readonly NativeSettingsPathOp[]).reduce(applyPathOp, stored)
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
        for (const watcher of registration.listeners) {
          const notification = watcher.tail
            .then(() => {
              if (!watcher.active || this.closed) return
              return watcher.callback(next, previous)
            })
            .then(() => undefined, () => {
              console.warn(`settings: change listener failed for namespace "${registration.namespace}"`)
            })
          watcher.tail = notification
          this.pendingNotifications.add(notification)
          void notification.then(() => this.pendingNotifications.delete(notification))
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
  if (snapshot === undefined || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new TypeError('settings section must contain JSON values')
  }
  return snapshot as NativeSettingsSection
}

function resolved<T>(resolver: (value: NativeSettingsSection) => T, value: NativeSettingsSection): T {
  const snapshot = snapshotJsonValue(resolver(value))
  if (snapshot === undefined) throw new TypeError('resolved settings must contain JSON values')
  return deepFreeze(snapshot)
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

function snapshotPathOps(ops: readonly NativeSettingsPathOp[]): NativeSettingsPathOp[] {
  const candidates: unknown = ops
  if (!Array.isArray(candidates)) throw new TypeError('settings mutate: expected an array of path ops')
  return (candidates as readonly unknown[]).map((candidate: unknown) => {
    if (!isRecord(candidate)) {
      throw new TypeError('settings mutate: each op needs a string path')
    }
    const pathValue: unknown = candidate.path
    if (!Array.isArray(pathValue) || !pathValue.every((part: unknown) => typeof part === 'string')) {
      throw new TypeError('settings mutate: each op needs a string path')
    }
    const path = (pathValue as readonly unknown[]).map(part => part as string)
    if (candidate.op === 'unset') return { op: 'unset', path }
    if (candidate.op !== 'set') throw new TypeError('settings mutate: op must be set or unset')
    const wrapped = section({ value: candidate.value })
    if (!Object.prototype.hasOwnProperty.call(wrapped, 'value')) throw new TypeError('settings mutate: set values must be JSON data')
    return { op: 'set', path, value: wrapped.value }
  })
}

function applyPathOp(sectionValue: NativeSettingsSection, op: NativeSettingsPathOp): NativeSettingsSection {
  return applyPathValue(sectionValue, op) as NativeSettingsSection
}

function applyPathValue(value: unknown, op: NativeSettingsPathOp): unknown {
  const [head, ...rest] = op.path
  if (head === undefined) return op.op === 'unset' ? {} : section(op.value)
  if (Array.isArray(value)) {
    if (!/^(0|[1-9]\d*)$/.test(head)) throw new TypeError('settings mutate: array paths need an existing index')
    const index = Number(head)
    if (!Number.isSafeInteger(index) || index >= value.length) throw new TypeError('settings mutate: array paths need an existing index')
    const result = Array.from(value as readonly unknown[])
    if (rest.length === 0) {
      if (op.op === 'unset') throw new TypeError('settings mutate: array entries cannot be removed')
      result[index] = op.value
    } else result[index] = applyPathValue(value[index], { ...op, path: rest })
    return result
  }
  const result = isRecord(value) ? section(value) : {}
  if (rest.length === 0) {
    if (op.op === 'unset') Reflect.deleteProperty(result, head)
    else setOwn(result, head, op.value)
    return result
  }
  const child = result[head]
  if (typeof child !== 'object' || child === null) {
    if (op.op === 'unset') return result
    setOwn(result, head, applyPathValue({}, { ...op, path: rest }))
    return result
  }
  setOwn(result, head, applyPathValue(child, { ...op, path: rest }))
  return result
}

interface SchemaNode {
  readonly type?: string
  readonly meta?: { readonly role?: unknown }
  readonly dict?: Readonly<Record<string, SchemaNode>>
  readonly inner?: SchemaNode
  readonly list?: readonly SchemaNode[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stripSchemaDefaults(serialized: unknown): unknown {
  const document = snapshotJsonValue(serialized)
  if (!isRecord(document)) throw new TypeError('settings schema must serialize as an object')
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry)
      return
    }
    if (!isRecord(value)) return
    if (isRecord(value.meta)) delete value.meta.default
    for (const entry of Object.values(value)) visit(entry)
  }
  visit(document)
  return document
}

function credentialRefs(schema: SchemaNode, value: unknown): string[] {
  const refs = new Set<string>()
  const visit = (node: SchemaNode | undefined, current: unknown): void => {
    if (node === undefined) return
    if (node.meta?.role === 'credential-ref') {
      if (typeof current === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(current)) refs.add(current)
      return
    }
    if (node.type === 'object' && typeof current === 'object' && current !== null && !Array.isArray(current)) {
      for (const [key, child] of Object.entries(node.dict ?? {})) visit(child, Reflect.get(current, key))
    } else if (node.type === 'dict' && typeof current === 'object' && current !== null && !Array.isArray(current)) {
      for (const entry of Object.values(current)) visit(node.inner, entry)
    } else if (node.type === 'array' && Array.isArray(current)) {
      for (const entry of current) visit(node.inner, entry)
    }
  }
  visit(schema, value)
  return [...refs]
}

function hasUnsupportedSecret(schema: SchemaNode): boolean {
  const seen = new WeakMap<SchemaNode, Set<boolean>>()
  const visit = (node: SchemaNode | undefined, supportedPath: boolean): boolean => {
    if (node === undefined) return false
    const modes = seen.get(node) ?? new Set<boolean>()
    if (modes.has(supportedPath)) return false
    modes.add(supportedPath)
    seen.set(node, modes)
    if (node.meta?.role === 'secret') return !supportedPath
    const children = node.type === 'object' ? Object.values(node.dict ?? {})
      : node.type === 'dict' || node.type === 'array' ? [node.inner]
        : [...node.list ?? [], node.inner, ...Object.values(node.dict ?? {})]
    const childPathSupported = supportedPath && (node.type === 'object' || node.type === 'dict' || node.type === 'array')
    return children.some(child => visit(child, childPathSupported))
  }
  return visit(schema, true)
}

function containsSecret(node: SchemaNode | undefined): boolean {
  if (node === undefined) return false
  if (node.meta?.role === 'secret') return true
  if (node.type === 'object') return Object.values(node.dict ?? {}).some(containsSecret)
  if (node.type === 'dict') return containsSecret(node.inner)
  if (node.type === 'array') return containsSecret(node.inner)
  return false
}

function touchesSecret(node: SchemaNode | undefined, path: readonly string[]): boolean {
  if (node === undefined) return false
  if (node.meta?.role === 'secret') return true
  if (path.length === 0) return containsSecret(node)
  const [head, ...rest] = path
  if (head === undefined) return containsSecret(node)
  if (node.type === 'object') return touchesSecret(node.dict?.[head], rest)
  if (node.type === 'dict') return touchesSecret(node.inner, rest)
  if (node.type === 'array') {
    return /^(0|[1-9]\d*)$/.test(head) ? touchesSecret(node.inner, rest) : containsSecret(node)
  }
  return false
}

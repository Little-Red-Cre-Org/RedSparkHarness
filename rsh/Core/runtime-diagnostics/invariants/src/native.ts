/**
 * Native invariant registry. Installers subscribe through this host; they do not
 * receive a Cordis context.
 * @module @redspark/rsh-invariants/native
 */

import type { NativeContext, NativePlugin } from '@redspark/rsh-native-runtime'
import { z } from 'zod'
import { InvariantError, type InvariantFailure } from './error.ts'
import {
  assertInvariantPackageName,
  compileInvariantSelection,
  invariantPackageSelected,
  type InvariantSelection,
} from './selection.ts'

/** Subscriptions and resources owned by one native registration. */
export interface NativeInvariantHost {
  /** Aborted when the registration is disposed or the registry closes. */
  readonly signal: AbortSignal
  /** Subscribe for this registration's lifetime. */
  readonly on: NativeContext['on']
  /** Own a resource released with this registration. */
  readonly own: NativeContext['own']
}

/** Install one package's checks on the native host. */
export interface NativeInvariantInstaller {
  /**
   * Install the package contribution.
   * @param host - subscriptions and resources owned by this registration.
   * @param fail - reporter bound to the registering package name.
   * @returns nothing, or a promise settling after asynchronous checks finish.
   */
  (host: NativeInvariantHost, fail: InvariantFailure): void | Promise<void>
}

/** Native registry operations selected by a profile. */
export interface NativeInvariantRegistry {
  /**
   * Reserve one package name and run its installer when the filters admit it.
   * @param packageName - full npm package name that owns the contribution.
   * @param installer - startup check for this registration.
   * @returns a disposer that removes subscriptions, owned resources, and the reservation.
   */
  register(packageName: string, installer: NativeInvariantInstaller): Promise<() => Promise<void>>
}

declare module '@redspark/rsh-native-runtime' {
  interface NativeServices {
    invariants: NativeInvariantRegistry
  }
}

interface RegistrationResources {
  readonly controller: AbortController
  readonly releases: Array<() => Promise<void>>
}

/** Admission and reservation for native installers. */
export class NativeInvariantRegistryController implements NativeInvariantRegistry {
  private readonly selection: InvariantSelection
  private readonly names = new Set<string>()
  private readonly disposers = new Set<() => Promise<void>>()
  private readonly inflight = new Set<AbortController>()
  private closed = false

  /**
   * Create a registry bound to one native installation.
   * @param selection - compiled filters from profile resolution.
   * @param context - installation that owns event subscriptions.
   */
  constructor(selection: InvariantSelection, private readonly context: NativeContext) {
    this.selection = selection
  }

  /**
   * Reserve one package and run the installer when selected.
   * @param packageName - full npm package name that owns the contribution.
   * @param installer - startup check for this registration.
   * @returns a disposer that awaits resource release before dropping the reservation.
   */
  async register(packageName: string, installer: NativeInvariantInstaller): Promise<() => Promise<void>> {
    assertInvariantPackageName(packageName)
    if (this.closed) throw new Error('invariants: registry is closed')
    if (this.names.has(packageName)) {
      throw new Error(`invariants: package "${packageName}" is already registered`)
    }
    this.names.add(packageName)
    const resources: RegistrationResources = { controller: new AbortController(), releases: [] }
    this.inflight.add(resources.controller)
    const releaseName = () => { this.names.delete(packageName) }
    try {
      if (invariantPackageSelected(this.selection, packageName)) {
        await installer(this.host(resources), (message): never => {
          throw new InvariantError(packageName, message)
        })
      }
      if (this.closed || resources.controller.signal.aborted) {
        throw new Error('invariants: registry is closed')
      }
    } catch (error) {
      this.inflight.delete(resources.controller)
      await this.release(resources)
      releaseName()
      throw error
    }
    let disposed = false
    const dispose = async () => {
      if (disposed) return
      disposed = true
      this.disposers.delete(dispose)
      this.inflight.delete(resources.controller)
      resources.controller.abort()
      try {
        await this.release(resources)
      } finally {
        releaseName()
      }
    }
    this.disposers.add(dispose)
    return dispose
  }

  /** Release every live registration. */
  async close(): Promise<void> {
    this.closed = true
    for (const controller of this.inflight) controller.abort()
    const pending = [...this.disposers]
    await Promise.all(pending.map(dispose => dispose()))
  }

  private host(resources: RegistrationResources): NativeInvariantHost {
    return {
      signal: resources.controller.signal,
      on: (key, listener) => {
        resources.controller.signal.throwIfAborted()
        const unsubscribe = this.context.on(key, listener)
        resources.releases.push(unsubscribe)
        return unsubscribe
      },
      own: (dispose) => {
        resources.controller.signal.throwIfAborted()
        const release = this.context.own(dispose)
        resources.releases.push(release)
        return release
      },
    }
  }

  private async release(resources: RegistrationResources): Promise<void> {
    resources.controller.abort()
    const releases = resources.releases.splice(0)
    await Promise.all(releases.map(release => release()))
  }
}

const selectionSchema = z.object({
  enabled: z.boolean().default(true),
  package_allowlist: z.array(z.string()).default([]),
  package_blocklist: z.array(z.string()).default([]),
}).strict()

/**
 * Validate native invariant filters before activation.
 * @param input - untrusted profile fields; omitted input uses the defaults.
 * @returns compiled selection.
 */
export function resolveNativeInvariantConfig(input: unknown): InvariantSelection {
  const parsed = selectionSchema.parse(input === undefined ? {} : input)
  return compileInvariantSelection(parsed)
}

/** Host plugin that provides `invariants` for package-owned native checks. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-invariants',
  targets: ['host'],
  requires: [],
  optional: [],
  provides: ['invariants'],
  resolve(input) {
    const selection = resolveNativeInvariantConfig(input)
    return (context) => {
      const registry = new NativeInvariantRegistryController(selection, context)
      context.own(() => registry.close())
      context.provide('invariants', registry)
    }
  },
}

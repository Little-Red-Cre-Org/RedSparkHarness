/**
 * Native entrypoint for the client resource model.
 *
 * The browser half provides `ctx.resources` and contributes the `resource`
 * root keyed hook, so every slot component receives `useResource`. A Native
 * client has neither `ctx.reflect` nor a Cordis Context, so this half provides
 * the same registry as `clientNativeResources` and contributes the same root
 * keyed hook through `slots.provideRoot`. The registry is the browser half's
 * own code: both builds adapt their Context to one narrow effect port.
 */
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type { RootStandardSourceContribution } from '@redspark/rsh-client-ui-slots'
import type {} from '@redspark/rsh-client-ui-renderer/native'
import { ResourceRegistry, type ResourceEffectHost } from './client/resources.ts'
import type { Resources } from './client/contract.ts'

export type {
  ResourceOpenContext,
  ResourceProtocol,
  ResourceProvider,
  Resources,
  ResourceSnapshot,
  ResourceStatus,
  UseResource,
} from './client/contract.ts'
export type { ResourceProtocolMap } from '@redspark/rsh-client-ui-slots'

declare module '@redspark/rsh-native-runtime' {
  interface NativeServices {
    /** Protocol-registered providers and the per-address live sources behind `useResource`. */
    clientNativeResources: Resources
  }
}

/**
 * The one slot capability this half needs: contribute the root standard sources.
 *
 * Declared structurally rather than as `SlotRuntime` so the contract states
 * exactly what the resource model touches, and a test can supply a stand-in.
 */
export interface NativeResourceSlots {
  /**
   * Contribute domain-owned root data.
   * @param contribution - the keyed hook source.
   * @returns disposer that withdraws the contribution.
   */
  provideRoot(contribution: RootStandardSourceContribution): () => void
}

/** The Native resource model and the release that withdraws it. */
export interface NativeResourcesInstallation {
  /** The registry the browser half owns, served over Native slots. */
  readonly resources: ResourceRegistry
  /**
   * Withdraw the root `useResource` contribution and the registry.
   * @returns completion after both are released.
   */
  dispose(): Promise<void>
}

/**
 * Build the Native resource model over one SlotRuntime.
 *
 * The two resources release in reverse acquisition order: the root keyed hook
 * first, then the registry, so no component can observe `useResource` over a
 * registry that already stopped holding its providers.
 * @param slots - the shared Native slot runtime.
 * @param effect - the owning Context's effect runner.
 * @returns the registry and the release for both registrations.
 */
export function createNativeResources(
  slots: NativeResourceSlots,
  effect: ResourceEffectHost['effect'],
): NativeResourcesInstallation {
  const resources = new ResourceRegistry({ effect })
  const disposeRoot = slots.provideRoot({
    keyedHooks: { resource: address => resources.source(address) },
  } satisfies RootStandardSourceContribution)
  return {
    resources,
    dispose: () => {
      disposeRoot()
      return Promise.resolve()
    },
  }
}

/** Native resource model: the browser half's registry over the Native slot runtime. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-client-resources',
  targets: ['client'],
  requires: ['clientSlots'],
  optional: [],
  provides: ['clientNativeResources'],
  resolve: () => (context) => {
    const slots = context.require('clientSlots')
    const installation = createNativeResources(slots, (setup, label) => {
      // NativeContext owns the drain and reports its own label; the registry
      // only needs the idempotent release.
      void label
      const release = context.effect(setup())
      return () => { void release() }
    })
    context.provide('clientNativeResources', installation.resources)
    context.own(() => installation.dispose())
  },
}

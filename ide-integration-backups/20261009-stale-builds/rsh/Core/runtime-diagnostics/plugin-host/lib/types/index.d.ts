/**
 * RSH plugin-role registry and adapter over the owned Cordis runtime.
 * @module @deepseek-ai/dsh-plugin-host
 */
import { Context, Service } from '@deepseek-ai/cordis';
import type { Fiber, Plugin, Inject } from '@deepseek-ai/cordis';
/** Runtime API revision implemented by this package. */
export declare const RSH_PLUGIN_API_VERSION: 1;
/** Roles a native RSH entry may have inside one capability domain. */
export type RshPluginRole = 'definition' | 'provider' | 'consumer' | 'policy' | 'projection' | 'adapter';
/** Static RSH ownership facts declared by a plugin package. */
export interface RshPluginDescriptor {
    /** Full npm package name that owns the entry. */
    readonly packageName: string;
    /** Runtime API revision understood by this host. */
    readonly apiVersion: typeof RSH_PLUGIN_API_VERSION;
    /** Role the plugin serves within its capability domain. */
    readonly role: RshPluginRole;
    /** Stable capability domain, for example `filesystem`. */
    readonly capability: string;
}
/** One active legacy Cordis plugin mounted through an RSH descriptor. */
export interface MountedRshPlugin {
    /** Descriptor registered before the Cordis plugin starts. */
    readonly descriptor: RshPluginDescriptor;
    /** Cordis lifecycle owner for the adapted plugin. */
    readonly fiber: Fiber;
    /** Dispose the Cordis fiber and release the descriptor reservation. */
    dispose(): Promise<void>;
}
/** Cordis object-plugin form produced by {@link adaptCordisPlugin}. */
export interface CordisPluginAdapter {
    readonly name: string;
    readonly Config?: NonNullable<Plugin.Base['Config']>;
    readonly inject: Inject;
    readonly provide?: string | string[];
    readonly intercept?: NonNullable<Plugin.Base['intercept']>;
    readonly rsh: RshPluginDescriptor;
    apply(ctx: Context, config: unknown): Promise<void>;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        pluginHost: RshPluginHost;
    }
}
declare const reserveAdapter: unique symbol;
/**
 * Owns declared RSH plugin identities and adapts legacy Cordis plugins without
 * replacing Cordis services, events, Loader configuration, or fiber lifecycle.
 */
export declare class RshPluginHost extends Service {
    private readonly descriptors;
    private readonly ownerCtx;
    /** Install the registry as `ctx.pluginHost`. */
    constructor(ctx: Context);
    private reserve;
    /**
     * Reserve a descriptor while its owner is mounted. Active duplicate names fail immediately.
     * @param descriptor - declared RSH ownership facts.
     * @returns an idempotent disposer that releases only this reservation.
     */
    register(descriptor: RshPluginDescriptor): () => void;
    [reserveAdapter](descriptor: RshPluginDescriptor, owner: Fiber): Promise<(() => void) | undefined>;
    /**
     * Return the current descriptor for one package.
     * @param packageName - full npm package name.
     * @returns the descriptor, or undefined when no owner is active.
     */
    get(packageName: string): RshPluginDescriptor | undefined;
    /**
     * List active descriptors in stable package-name order.
     * @returns every descriptor currently reserved by a mounted adapter.
     */
    entries(): readonly RshPluginDescriptor[];
}
/**
 * Adapt an existing Cordis plugin for a Loader row without changing its public
 * configuration. The wrapper preserves the original Cordis metadata and awaits
 * the child Fiber, so child activation failure rejects the owning Loader entry.
 * Module HMR waits for the prior adapter Fiber and its child to finish disposal
 * before reusing the package name; another active owner remains a duplicate.
 * @param descriptor - declared RSH role and capability identity.
 * @param plugin - existing Cordis plugin entrypoint.
 * @returns a Loader-compatible object plugin.
 */
export declare function adaptCordisPlugin(descriptor: RshPluginDescriptor, plugin: Plugin): CordisPluginAdapter;
/**
 * Mount a current Cordis plugin through an RSH descriptor. The plugin still runs
 * in Cordis and its Fiber remains the single lifecycle authority.
 * @param ctx - Context that owns the adapted plugin.
 * @param descriptor - declared RSH role and capability identity.
 * @param plugin - existing Cordis plugin entrypoint.
 * @param config - plugin configuration passed unchanged to Cordis.
 * @returns the active fiber and a disposer that settles Cordis teardown first.
 */
export declare function mountCordisPlugin(ctx: Context, descriptor: RshPluginDescriptor, plugin: Plugin, config?: unknown): Promise<MountedRshPlugin>;
export default RshPluginHost;
//# sourceMappingURL=index.d.ts.map
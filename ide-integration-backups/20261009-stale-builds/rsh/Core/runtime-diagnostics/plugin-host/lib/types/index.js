/**
 * RSH plugin-role registry and adapter over the owned Cordis runtime.
 * @module @deepseek-ai/dsh-plugin-host
 */
import { Service } from '@deepseek-ai/cordis';
/** Runtime API revision implemented by this package. */
export const RSH_PLUGIN_API_VERSION = 1;
function assertDescriptor(descriptor) {
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- descriptors can come from runtime package metadata.
    if (descriptor.apiVersion !== RSH_PLUGIN_API_VERSION) {
        throw new Error(`plugin-host: ${descriptor.packageName} declares unsupported runtime API ${String(descriptor.apiVersion)}`);
    }
    if (descriptor.packageName.length === 0
        || descriptor.packageName.trim() !== descriptor.packageName
        || /\s/u.test(descriptor.packageName)) {
        throw new Error('plugin-host: descriptor packageName must be non-blank and contain no whitespace');
    }
    if (descriptor.capability.length === 0 || descriptor.capability.trim() !== descriptor.capability || /\s/u.test(descriptor.capability)) {
        throw new Error(`plugin-host: ${descriptor.packageName} declares an invalid capability`);
    }
    if (!['definition', 'provider', 'consumer', 'policy', 'projection', 'adapter'].includes(descriptor.role)) {
        throw new Error(`plugin-host: ${descriptor.packageName} declares an unsupported role ${descriptor.role}`);
    }
}
const reserveAdapter = Symbol('plugin-host reserve adapter');
/**
 * Owns declared RSH plugin identities and adapts legacy Cordis plugins without
 * replacing Cordis services, events, Loader configuration, or fiber lifecycle.
 */
export class RshPluginHost extends Service {
    descriptors = new Map();
    ownerCtx;
    /** Install the registry as `ctx.pluginHost`. */
    constructor(ctx) {
        super(ctx, 'pluginHost');
        this.ownerCtx = ctx;
    }
    reserve(descriptor, owner) {
        assertDescriptor(descriptor);
        const current = this.descriptors.get(descriptor.packageName);
        if (current !== undefined) {
            throw new Error(`plugin-host: ${descriptor.packageName} is already registered as ${current.descriptor.role} for ${current.descriptor.capability}`);
        }
        const reservation = { descriptor, ...(owner === undefined ? {} : { owner }) };
        if (owner !== undefined) {
            reservation.settled = new Promise((resolve) => { reservation.settle = resolve; });
        }
        this.descriptors.set(descriptor.packageName, reservation);
        let disposed = false;
        return () => {
            if (disposed)
                return;
            disposed = true;
            const finish = () => {
                /* v8 ignore next -- the disposer is idempotent and exclusively owns this slot. */
                if (this.descriptors.get(descriptor.packageName) === reservation) {
                    this.descriptors.delete(descriptor.packageName);
                }
                reservation.settle?.();
            };
            if (owner === undefined || owner.uid !== null) {
                finish();
                return;
            }
            // The wrapper's own effect cannot await its Fiber; finish outside that unload.
            const retire = async () => {
                try {
                    while (owner.inertia !== undefined)
                        await owner.inertia;
                }
                finally {
                    finish();
                }
            };
            /* v8 ignore next 3 -- Cordis's unload task rejects only when its logger fails. */
            void retire().catch((error) => {
                this.ownerCtx.logger.error(error);
            });
        };
    }
    /**
     * Reserve a descriptor while its owner is mounted. Active duplicate names fail immediately.
     * @param descriptor - declared RSH ownership facts.
     * @returns an idempotent disposer that releases only this reservation.
     */
    register(descriptor) {
        return this.reserve(descriptor);
    }
    async [reserveAdapter](descriptor, owner) {
        assertDescriptor(descriptor);
        while (owner.uid !== null) {
            const current = this.descriptors.get(descriptor.packageName);
            if (current === undefined)
                return this.reserve(descriptor, owner);
            if (current.owner?.uid !== null || current.settled === undefined) {
                throw new Error(`plugin-host: ${descriptor.packageName} is already registered as ${current.descriptor.role} for ${current.descriptor.capability}`);
            }
            let cancel;
            const cancelled = new Promise((resolve) => { cancel = resolve; });
            const off = this.ownerCtx.on('internal/plugin', (fiber) => {
                if (fiber === owner && fiber.uid === null)
                    cancel();
            }, { global: true });
            try {
                await Promise.race([current.settled, cancelled]);
            }
            finally {
                off();
            }
        }
        return undefined;
    }
    /**
     * Return the current descriptor for one package.
     * @param packageName - full npm package name.
     * @returns the descriptor, or undefined when no owner is active.
     */
    get(packageName) {
        return this.descriptors.get(packageName)?.descriptor;
    }
    /**
     * List active descriptors in stable package-name order.
     * @returns every descriptor currently reserved by a mounted adapter.
     */
    entries() {
        return [...this.descriptors.values()].map(({ descriptor }) => descriptor)
            .sort((left, right) => left.packageName.localeCompare(right.packageName));
    }
}
function pluginName(plugin, fallback) {
    return plugin.name ?? fallback;
}
function mergedInject(inject) {
    if (inject === undefined)
        return ['pluginHost'];
    if (Array.isArray(inject))
        return [...new Set(['pluginHost', ...inject])];
    return { pluginHost: undefined, ...inject };
}
/**
 * Copy Cordis plugin metadata into the RSH object wrapper. This keeps config
 * validation, dependency activation, provider registration, and intercept
 * behavior owned by the original entry.
 * @param plugin - existing Cordis plugin entrypoint.
 * @param name - fallback Loader diagnostic name.
 * @returns metadata copied by the adapter.
 */
function pluginMetadata(plugin, name) {
    return {
        name: pluginName(plugin, name),
        ...(plugin.Config === undefined ? {} : { Config: plugin.Config }),
        inject: mergedInject(plugin.inject),
        ...(plugin.provide === undefined ? {} : { provide: plugin.provide }),
        ...(plugin.intercept === undefined ? {} : { intercept: plugin.intercept }),
    };
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
export function adaptCordisPlugin(descriptor, plugin) {
    assertDescriptor(descriptor);
    const adapter = {
        ...pluginMetadata(plugin, `rsh-adapter:${descriptor.packageName}`),
        rsh: descriptor,
        async apply(ctx, config) {
            const host = ctx.pluginHost;
            // oxlint-disable-next-line typescript/no-unnecessary-condition -- a Loader composition can omit the host at runtime.
            if (host === undefined)
                throw new Error(`plugin-host: ${descriptor.packageName} requires ctx.pluginHost`);
            const unregister = await host[reserveAdapter](descriptor, ctx.fiber);
            if (unregister === undefined)
                return;
            let child;
            let cleanup;
            const dispose = () => cleanup ??= (async () => {
                try {
                    await child?.dispose();
                    while (child?.inertia !== undefined)
                        await child.inertia;
                }
                finally {
                    unregister();
                }
            })();
            try {
                ctx.effect(() => dispose, `plugin-host adapter ${descriptor.packageName}`);
                const startingChild = ctx.plugin(plugin, config);
                child = startingChild;
                await startingChild;
            }
            catch (error) {
                await dispose();
                throw error;
            }
        },
    };
    return adapter;
}
/**
 * Mount a current Cordis plugin through an RSH descriptor. The plugin still runs
 * in Cordis and its Fiber remains the single lifecycle authority.
 * @param ctx - Context that owns the adapted plugin.
 * @param descriptor - declared RSH role and capability identity.
 * @param plugin - existing Cordis plugin entrypoint.
 * @param config - plugin configuration passed unchanged to Cordis.
 * @returns the active fiber and a disposer that settles Cordis teardown first.
 */
export async function mountCordisPlugin(ctx, descriptor, plugin, config) {
    const host = ctx.pluginHost;
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- an integration Context can omit the host at runtime.
    if (host === undefined)
        throw new Error(`plugin-host: ${descriptor.packageName} requires ctx.pluginHost`);
    const unregister = host.register(descriptor);
    let fiber;
    try {
        fiber = await ctx.plugin(plugin, config);
        fiber.ctx.effect(() => unregister, `plugin-host direct mount ${descriptor.packageName}`);
    }
    catch (error) {
        unregister();
        throw error;
    }
    return {
        descriptor,
        fiber,
        dispose: () => fiber.dispose(),
    };
}
export default RshPluginHost;
//# sourceMappingURL=index.js.map
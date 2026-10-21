import { createLaunchEnvironmentSnapshot } from "./native.js";
export * from "./native.js";
/** Context slot the launcher fills with this run's snapshot before any config entry mounts. */
export const DSH_LAUNCH_ENVIRONMENT_KEY = 'launchEnvironment';
/**
 * Return the launcher's snapshot, or the inherited environment as the sole
 * layer when the host provided none.
 * @param ctx - the consuming plugin's context.
 * @returns the snapshot to resolve user-facing values against.
 */
export function launchEnvironmentOf(ctx) {
    return ctx.get(DSH_LAUNCH_ENVIRONMENT_KEY)
        ?? createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env }]);
}
//# sourceMappingURL=index.js.map
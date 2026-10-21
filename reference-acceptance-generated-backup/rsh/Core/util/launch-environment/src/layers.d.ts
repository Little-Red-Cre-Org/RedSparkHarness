import { type LaunchEnvironmentSnapshot } from './native.ts';
/**
 * Load the product CLI's inherited > invoking-directory `.env` > Harness-home
 * `.env` snapshot. The Harness home resolves before either file; both files
 * are checked before either is applied, and accepted values are materialized
 * without replacing inherited ones. The snapshot preserves which layer supplied each value.
 * @param binName - the diagnostic prefix on the diagnostics.
 * @param cwd - the invoking directory whose `.env` is the project layer.
 * @param warn - sink for the one-line misconfiguration diagnostics.
 * @returns this run's frozen environment snapshot.
 * @throws when either file declares a bootstrap-only variable, except {@link HOME_LAYER_PROXY_NAMES} in the Harness-home file.
 */
export declare function loadLayeredEnv(binName: string, cwd?: string, warn?: (line: string) => void): LaunchEnvironmentSnapshot;
//# sourceMappingURL=layers.d.ts.map
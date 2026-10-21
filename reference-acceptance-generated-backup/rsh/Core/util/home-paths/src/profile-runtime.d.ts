/** Shared validation for profile execution markers stored under a DSH home. */
/** Runtime and reload mode declared by one Harness profile package. */
export interface DshProfileExecution {
    runtime: 'native' | 'legacy';
    reload: 'startup' | 'live';
}
/**
 * Read the runtime marker from one profile package manifest.
 * @param profileDir - directory containing the profile's package.json.
 * @returns the validated profile runtime and configuration reload mode.
 */
export declare function resolveDshProfileDirectoryExecution(profileDir: string): DshProfileExecution;
/**
 * Read one profile's execution marker under the resolved Harness home.
 * @param name - profile directory name.
 * @param home - resolved Harness home.
 * @returns the validated profile runtime and configuration reload mode.
 */
export declare function resolveDshProfileExecution(name: string, home: string): DshProfileExecution;
/** Reject names that can escape or alias the profile directory.
 * @param name - profile directory name.
 */
export declare function validateDshProfileName(name: string): void;
//# sourceMappingURL=profile-runtime.d.ts.map
/** Shared validation for profile execution markers stored under a DSH home. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
function object(value, label) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new Error(`${label} must be an object`);
    return value;
}
function record(value, label, allowed) {
    const fields = object(value, label);
    for (const key of Object.keys(fields))
        if (!allowed.includes(key))
            throw new Error(`${label} has unknown field ${key}`);
    return fields;
}
/**
 * Read the runtime marker from one profile package manifest.
 * @param profileDir - directory containing the profile's package.json.
 * @returns the validated profile runtime and configuration reload mode.
 */
export function resolveDshProfileDirectoryExecution(profileDir) {
    const manifestPath = join(profileDir, 'package.json');
    if (!existsSync(manifestPath))
        return { runtime: 'legacy', reload: 'startup' };
    const manifest = object(JSON.parse(readFileSync(manifestPath, 'utf8')), 'profile package');
    const dsh = manifest.dsh === undefined ? {} : object(manifest.dsh, 'profile dsh');
    const profile = dsh.profile === undefined ? {} : record(dsh.profile, 'dsh.profile', ['bundles', 'patchReload', 'runtime', 'config', 'configReload']);
    if (profile.runtime === undefined) {
        if (profile.config !== undefined || profile.configReload !== undefined)
            throw new Error('dsh.profile.config/configReload requires runtime native');
        return { runtime: 'legacy', reload: 'startup' };
    }
    if (profile.runtime !== 'native' || profile.config !== 'rsh.profile.json') {
        throw new Error('dsh.profile.runtime/config must select native and rsh.profile.json');
    }
    if (profile.bundles !== undefined || profile.patchReload !== undefined) {
        throw new Error('native profile cannot declare Cordis bundles or patchReload');
    }
    if (profile.configReload !== undefined && profile.configReload !== 'startup' && profile.configReload !== 'live') {
        throw new Error('dsh.profile.configReload must be startup or live');
    }
    return { runtime: 'native', reload: profile.configReload ?? 'startup' };
}
/**
 * Read one profile's execution marker under the resolved Harness home.
 * @param name - profile directory name.
 * @param home - resolved Harness home.
 * @returns the validated profile runtime and configuration reload mode.
 */
export function resolveDshProfileExecution(name, home) {
    validateDshProfileName(name);
    return resolveDshProfileDirectoryExecution(join(home, 'profiles', name));
}
/** Reject names that can escape or alias the profile directory.
 * @param name - profile directory name.
 */
export function validateDshProfileName(name) {
    if (name === '' || name === '.' || name === '..' || name === 'node_modules' || name.includes('/') || name.includes('\\')) {
        throw new Error(`dsh: invalid profile name ${JSON.stringify(name)}`);
    }
}
//# sourceMappingURL=profile-runtime.js.map
/** Layer order, most trusted first. */
const SOURCE_ORDER = ['process', 'project-env', 'user-env'];
/**
 * The map key one variable name resolves under. Windows treats environment
 * names case-insensitively; every other platform does not.
 * @param name - the variable name as written.
 * @returns the key to store and look up by.
 */
function lookupKey(name) {
    /* v8 ignore next -- native Windows coverage exercises the folding arm; POSIX covers the exact one */
    return process.platform === 'win32' ? name.toUpperCase() : name;
}
/**
 * Build the snapshot from each layer's contents.
 * @param layers - the layers in any order; the result searches them by canonical trust order.
 * @returns the immutable snapshot.
 */
export function createLaunchEnvironmentSnapshot(layers) {
    // Copy every layer so later mutations cannot change the snapshot. Fold names
    // on Windows so case variants cannot split precedence; POSIX remains exact.
    const bySource = new Map();
    for (const layer of layers) {
        bySource.set(layer.source, {
            ...layer.path === undefined ? {} : { path: layer.path },
            values: new Map(Object.entries(layer.values).map(([name, value]) => [lookupKey(name), value])),
        });
    }
    const getFrom = (name, sources) => {
        const key = lookupKey(name);
        for (const source of SOURCE_ORDER) {
            if (!sources.includes(source))
                continue;
            const layer = bySource.get(source);
            const value = layer?.values.get(key);
            if (value === undefined)
                continue;
            return { value, source, ...layer?.path === undefined ? {} : { path: layer.path } };
        }
        return undefined;
    };
    return {
        get: name => getFrom(name, SOURCE_ORDER),
        getFrom,
    };
}
/**
 * Detect SSH from non-empty SSH_CONNECTION or SSH_TTY inherited at launch.
 * Project and user `.env` values never establish an SSH session.
 * @param environment - the launcher's environment snapshot.
 * @returns whether the inherited process layer carries either SSH marker.
 */
export function launchedThroughSsh(environment) {
    return ['SSH_CONNECTION', 'SSH_TTY'].some((name) => {
        const value = environment.getFrom(name, ['process'])?.value;
        return value !== undefined && value !== '';
    });
}
/**
 * Install the launcher's immutable snapshot without putting its secret values in profile configuration.
 * @param snapshot - frozen environment assembled by the application launcher.
 * @returns provider selected by a native Host composition.
 */
export function launchEnvironmentProvider(snapshot) {
    return {
        apiVersion: 1,
        name: '@deepseek-ai/dsh-launch-environment',
        targets: ['host'],
        requires: [],
        provides: ['launchEnvironment'],
        resolve(input) {
            if (input !== undefined)
                throw new Error('launch-environment: provider takes no profile configuration');
            return (context) => { context.provide('launchEnvironment', snapshot); };
        },
    };
}
//# sourceMappingURL=native.js.map
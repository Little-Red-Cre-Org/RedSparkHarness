/**
 * Virtual root of the worker host's in-memory filesystem. Kept
 * in one module so the process shim, the path/os shims, and the VFS image
 * collector cannot drift apart.
 */

/** Virtual filesystem root; `process.cwd()` and every absolute path start here. */
export const RSH_ROOT = '/dsh'

/** `$RSH_HOME`: durable-state directory inside the image. */
export const RSH_HOME = `${RSH_ROOT}/home`

/** Flat, symlink-free package tree resolved by the worker module loader. */
export const RSH_NODE_MODULES = `${RSH_ROOT}/node_modules`

/** Directory holding the composed cordis.yml and the agent-preset tree. */
export const RSH_CONFIG = `${RSH_ROOT}/config`

/** Default (empty) workspace directory. */
export const RSH_WORKSPACE = `${RSH_ROOT}/workspace`

/** Temporary directory reported by `os.tmpdir()`. */
export const RSH_TMP = `${RSH_ROOT}/tmp`

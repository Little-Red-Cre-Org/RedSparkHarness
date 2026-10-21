/** Product launch environment loading shared by native and Cordis launchers. */
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { resolve } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { createLaunchEnvironmentSnapshot, type LaunchEnvironmentSnapshot } from './native.ts'

/** Exact names no discovered file may set. */
const BOOTSTRAP_NAMES = new Set([
  // Process launch and module resolution.
  'PATH', 'HOME', 'USERPROFILE', 'SHELL',
  'NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS',
  'LD_PRELOAD', 'LD_LIBRARY_PATH', 'LD_AUDIT',
  // Interpreter startup hooks.
  'BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS',
  'PERL5OPT', 'PERL5LIB', 'PYTHONSTARTUP', 'PYTHONPATH', 'RUBYOPT', 'RUBYLIB',
  'JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS',
  'PYTHONHOME',
  // Version-control hooks, config redirects, and ambient command selectors.
  'GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_EXTERNAL_DIFF', 'GIT_PAGER', 'GIT_EDITOR',
  'GIT_ASKPASS', 'SSH_ASKPASS',
  'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_COUNT',
  'EDITOR', 'VISUAL', 'PAGER', 'BROWSER',
  // Network reach and trust.
  'DEEPSEEK_BASE_URL', 'DEEPSEEK_SEARCH_BASE_URL',
  'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE',
  'NODE_TLS_REJECT_UNAUTHORIZED',
])

/** Name prefixes no discovered file may set. */
const BOOTSTRAP_PREFIXES = ['DSH_', 'XDG_', 'DYLD_', 'BASH_FUNC_']

/**
 * The bootstrap names the Harness-home `.env` alone may set. A proxy chooses the route every
 * request takes, so the invoking directory's file — which arrives with a clone — keeps refusing
 * them; the home file is the user's own, and `DSH_HOME` is itself bootstrap-only, so no `.env` can
 * relocate this exemption. The CA and TLS names in the same group stay refused everywhere: they
 * change what is trusted, not where traffic goes.
 */
const HOME_LAYER_PROXY_NAMES = new Set(['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY'])

/**
 * Whether a variable may come only from the inherited process environment
 * because it changes process, runtime, VCS, or network bootstrap. The Harness-home
 * file is additionally allowed {@link HOME_LAYER_PROXY_NAMES}.
 * @param name - the variable name.
 * @returns true when only the inherited environment may supply it.
 */
function isBootstrapOnly(name: string): boolean {
  const upper = name.toUpperCase()
  return BOOTSTRAP_NAMES.has(upper) || BOOTSTRAP_PREFIXES.some(prefix => upper.startsWith(prefix))
}

/**
 * Parse one directory's `.env` without applying it, rejecting bootstrap-only
 * names before any value is materialized.
 * @param binName - the diagnostic prefix on the thrown error.
 * @param dir - the directory whose `.env` to read.
 * @param warn - sink for the one-line unreadable-file diagnostic.
 * @param home - the resolved Harness home; when `dir` is it, {@link HOME_LAYER_PROXY_NAMES} are accepted.
 * @returns the parsed entries, or `undefined` when the file is absent or unreadable.
 * @throws when the file declares a name {@link isBootstrapOnly} rejects and this layer may not set.
 */
function readEnvLayer(
  binName: string, dir: string, warn: (line: string) => void, home: string,
): { path: string; values: Record<string, string> } | undefined {
  const path = resolve(dir, '.env')
  const isHome = resolve(dir) === home
  let content: string
  try {
    content = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') {
      warn(`${binName}: failed to load .env: ${String(error)}\n`)
    }
    // ENOENT (no .env) is fine — rely on the ambient environment.
    return undefined
  }
  // Parse once so validation and materialization use exactly the same entries.
  const values = parseEnv(content) as Record<string, string>
  for (const name of Object.keys(values)) {
    if (!isBootstrapOnly(name)) continue
    const proxyName = HOME_LAYER_PROXY_NAMES.has(name.toUpperCase())
    if (isHome && proxyName) continue
    // A proxy name has a second way out that the other bootstrap names do not, so its message says so.
    const remedy = proxyName
      ? `export ${name}, or put it in ${resolve(home, '.env')}, which does not travel with a repository`
      : `export ${name} instead of putting it in a .env file`
    throw new Error(
      `${binName}: ${path} sets "${name}", which only the launching environment may set`
      + ' (it decides how this process starts, where its code and instructions load from, or how it'
      + ` reaches the network); ${remedy}`,
    )
  }
  return { path, values }
}

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
export function loadLayeredEnv(
  binName: string, cwd: string = process.cwd(),
  warn: (line: string) => void = line => void process.stderr.write(line),
): LaunchEnvironmentSnapshot {
  const home = resolveDshHome()
  const inherited = { ...process.env } as Record<string, string>
  // Parse both layers first: a rejection must not leave one file applied.
  const project = readEnvLayer(binName, cwd, warn, home)
  const user = home === resolve(cwd) ? undefined : readEnvLayer(binName, home, warn, home)
  // Apply the checked values without replacing a higher-ranked name.
  for (const layer of [project, user]) {
    if (layer === undefined) continue
    for (const [name, value] of Object.entries(layer.values)) {
      if (process.env[name] === undefined) process.env[name] = value
    }
  }
  return createLaunchEnvironmentSnapshot([
    { source: 'process', values: inherited },
    ...project === undefined ? [] : [{ source: 'project-env' as const, path: project.path, values: project.values }],
    ...user === undefined ? [] : [{ source: 'user-env' as const, path: user.path, values: user.values }],
  ])
}

/** Managed shell environment values shared by Cordis and native Providers. */
import { DSH_HOME_ENV, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { DSH_ENV_PREFIX } from '@deepseek-ai/dsh-shell/native'
import type { DshEnvironment, DshEnvironmentKey } from '@deepseek-ai/dsh-shell/native'
import type { ShellEnvContributor, ShellEnvironment, ShellEnvVariable, ShellEnvVariableInfo } from './definition.ts'

const DSH_SHELL_KEY = `${DSH_ENV_PREFIX}SHELL` as const
const DSH_SESSION_ID_KEY = `${DSH_ENV_PREFIX}SESSION_ID` as const
const RESERVED_KEYS = new Set<DshEnvironmentKey>([DSH_HOME_ENV, DSH_SHELL_KEY, DSH_SESSION_ID_KEY])
const KEY_SUFFIX = /^[A-Z][A-Z0-9_]*$/

/** Registry mechanics independent of the plugin lifecycle that owns each disposer. */
export class ShellEnvController<Execution> implements ShellEnvironment<Execution> {
  private readonly contributors = new Map<string, ShellEnvContributor<Execution>>()
  private readonly keyOwners = new Map<DshEnvironmentKey, string>()
  private readonly dshHome: string

  /**
   * @param configuredHome - explicit Harness home, otherwise the normal home precedence applies.
   * @param sessionId - obtain the current Session id, or undefined outside an Agent call.
   */
  constructor(configuredHome: string | undefined, private readonly sessionId: (execution: Execution) => string | undefined) {
    this.dshHome = resolveDshHome(configuredHome)
  }

  /**
   * Claim contributor keys until the returned disposer is called.
   * @param contributor - declared ownership and per-call resolver.
   * @returns disposer for exactly this registration.
   */
  register(contributor: ShellEnvContributor<Execution>): () => void {
    if (contributor.name.trim().length === 0) throw new Error('bash env contributor name must be non-empty')
    if (this.contributors.has(contributor.name)) {
      throw new Error(`bash env contributor "${contributor.name}" is already registered`)
    }
    const variables = Object.entries(contributor.variables) as [DshEnvironmentKey, ShellEnvVariable][]
    for (const [key, variable] of variables) {
      if (!key.startsWith(DSH_ENV_PREFIX) || !KEY_SUFFIX.test(key.slice(DSH_ENV_PREFIX.length))) {
        throw new Error(`bash env contributor "${contributor.name}" declared invalid key "${key}"`)
      }
      if (RESERVED_KEYS.has(key)) {
        throw new Error(`bash env contributor "${contributor.name}" cannot own reserved key "${key}"`)
      }
      if (variable.description.trim().length === 0) {
        throw new Error(`bash env contributor "${contributor.name}" must describe "${key}"`)
      }
      const owner = this.keyOwners.get(key)
      if (owner !== undefined) {
        throw new Error(`bash env key "${key}" is already owned by contributor "${owner}"; contributor "${contributor.name}" cannot also own it`)
      }
    }
    this.contributors.set(contributor.name, contributor)
    for (const [key] of variables) this.keyOwners.set(key, contributor.name)
    return () => {
      if (this.contributors.get(contributor.name) !== contributor) return
      this.contributors.delete(contributor.name)
      for (const [key] of variables) this.keyOwners.delete(key)
    }
  }

  /**
   * Resolve a fresh, immutable managed environment for one call.
   * @param execution - current shell tool invocation.
   * @returns sorted built-in and contributed facts.
   */
  collect(execution: Execution): DshEnvironment {
    const values: Record<DshEnvironmentKey, string> = {
      [DSH_HOME_ENV]: this.dshHome,
      [DSH_SHELL_KEY]: '1',
    }
    const sessionId = this.sessionId(execution)
    if (sessionId !== undefined) values[DSH_SESSION_ID_KEY] = sessionId
    for (const contributor of [...this.contributors.values()].sort((left, right) => left.name.localeCompare(right.name))) {
      const resolved = contributor.resolve(execution)
      for (const [rawKey, value] of Object.entries(resolved)) {
        const key = rawKey as DshEnvironmentKey
        if (!Object.hasOwn(contributor.variables, key)) {
          throw new Error(`bash env contributor "${contributor.name}" returned undeclared key "${key}"`)
        }
        if (typeof value !== 'string') {
          throw new Error(`bash env contributor "${contributor.name}" returned a non-string value for "${key}"`)
        }
        values[key] = value
      }
    }
    return Object.freeze(Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right))))
  }

  /**
   * Enumerate contributed declarations without evaluating them.
   * @returns declarations sorted by variable name.
   */
  list(): ShellEnvVariableInfo[] {
    return [...this.contributors.values()]
      .flatMap(contributor => Object.entries(contributor.variables).map(([key, variable]) => ({
        contributor: contributor.name, description: variable.description, key: key as DshEnvironmentKey,
      })))
      .sort((left, right) => left.key.localeCompare(right.key))
  }
}

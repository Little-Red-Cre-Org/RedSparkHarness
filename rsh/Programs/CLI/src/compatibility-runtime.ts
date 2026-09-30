/** Preflight the optional package set before importing the legacy Cordis launcher. */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const compatibilityEntrypoints = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-app-boot',
  '@deepseek-ai/dsh-cmdline',
  '@deepseek-ai/dsh-http-proxy',
  '@deepseek-ai/dsh-launch-environment',
] as const

/**
 * Refuse legacy-only CLI modes with one installation remedy when optional packages are omitted.
 * @param resolveOptional - module resolver used to find each direct compatibility dependency.
 * @returns nothing when every direct compatibility dependency is resolvable.
 */
export function requireCompatibilityRuntime(
  resolveOptional: (specifier: string) => string = specifier => require.resolve(specifier),
): void {
  for (const specifier of compatibilityEntrypoints) {
    try {
      resolveOptional(specifier)
    } catch (cause: unknown) {
      throw new Error(
        `dsh: compatibility mode requires optional packages; reinstall @deepseek-ai/dsh with optional dependencies enabled (${specifier} is unavailable)`,
        { cause },
      )
    }
  }
}

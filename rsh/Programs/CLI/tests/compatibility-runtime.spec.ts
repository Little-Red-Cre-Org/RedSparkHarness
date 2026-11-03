import { describe, expect, it } from 'vitest'
import { requireCompatibilityRuntime } from '../src/compatibility-runtime.ts'

const dependencies = [
  '@redspark/cordis',
  '@redspark/rsh-app-boot',
  '@redspark/rsh-cmdline',
  '@redspark/rsh-http-proxy',
  '@redspark/rsh-launch-environment',
] as const

describe('CLI Cordis compatibility preflight', () => {
  it('resolves every direct optional runtime dependency before import', () => {
    const resolved: string[] = []
    requireCompatibilityRuntime((specifier) => {
      resolved.push(specifier)
      return specifier
    })
    expect(resolved).toEqual(dependencies)
  })

  it.each(dependencies)('refuses a missing optional dependency: %s', (missing) => {
    const resolved: string[] = []
    expect(() => {
      requireCompatibilityRuntime((specifier) => {
        resolved.push(specifier)
        if (specifier === missing) throw new Error('missing fixture')
        return specifier
      })
    }).toThrow(`dsh: compatibility mode requires optional packages; reinstall @redspark/rsh with optional dependencies enabled (${missing} is unavailable)`)
    expect(resolved).toEqual(dependencies.slice(0, dependencies.indexOf(missing) + 1))
  })
})

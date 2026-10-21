/** Built native entries must load without evaluating a Cordis module. */
import { globSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../../../../', import.meta.url))
const nativePackages = [
  ...globSync('rsh/Engine/*/*/package.json', { cwd: root }),
  ...globSync('rsh/Modules/Official/*/*/package.json', { cwd: root }),
].flatMap((manifestPath) => {
  const manifest = JSON.parse(readFileSync(join(root, manifestPath), 'utf8')) as {
    name: string
    dsh?: { native?: { entry: string } }
  }
  return manifest.dsh?.native === undefined
    ? []
    : [{ name: manifest.name, entry: manifest.dsh.native.entry, cwd: dirname(join(root, manifestPath)) }]
}).sort((a, b) => a.name.localeCompare(b.name))

const importScript = `
  import { registerHooks } from 'node:module'
  registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/cordis' || specifier.startsWith('@deepseek-ai/cordis/')) {
      throw new Error('Cordis imported by ' + context.parentURL)
    }
    return nextResolve(specifier, context)
  } })
  await import(process.argv[1])
  console.log('loaded')
`

function importInIsolatedNode(specifier: string, cwd: string) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', importScript, specifier], {
    cwd, encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, NODE_OPTIONS: undefined, NODE_PATH: undefined },
  })
}

describe.skipIf(process.env.DSH_EXAMPLE_MODE !== 'lib')('built native entry imports', () => {
  it('rejects a direct Cordis import', () => {
    const result = importInIsolatedNode('@deepseek-ai/cordis', nativePackages[0]!.cwd)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Cordis imported by')
  })

  it.each(nativePackages)('$name loads without Cordis', ({ name, entry, cwd }) => {
    const result = importInIsolatedNode(`${name}${entry.slice(1)}`, cwd)
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('loaded')
  })

  it('loads the native credential definition without Cordis', () => {
    const cwd = join(root, 'rsh/Modules/Official/credentials/credentials')
    const result = importInIsolatedNode('@deepseek-ai/dsh-credentials/native', cwd)
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('loaded')
  })

  it('loads the native launch environment without Cordis', () => {
    const cwd = join(root, 'rsh/Core/util/launch-environment')
    const result = importInIsolatedNode('@deepseek-ai/dsh-launch-environment/native', cwd)
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('loaded')
  })

  it('loads the browser module system entry without Cordis', () => {
    const cwd = join(root, 'rsh/Programs/Web/client/modules')
    const result = importInIsolatedNode('@deepseek-ai/dsh-client-modules/native', cwd)
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('loaded')
  })

  it('loads the browser native boot entry without Cordis', () => {
    const cwd = join(root, 'rsh/Programs/Web/client/web')
    const result = importInIsolatedNode('@deepseek-ai/dsh-client-web/native', cwd)
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('loaded')
  })
})

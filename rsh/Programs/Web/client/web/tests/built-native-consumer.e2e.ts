/** Packed browser-native entries must work in a project without Cordis. */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../../../../..')
const require = createRequire(import.meta.url)

function run(command: string, args: string[], cwd: string, timeout: number): string {
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', timeout,
    env: { ...process.env, NODE_OPTIONS: undefined, NODE_PATH: undefined },
  })
  expect(result.error).toBeUndefined()
  expect(result.status, result.stderr).toBe(0)
  return result.stdout
}

function pnpm(args: string[], cwd: string, timeout: number): string {
  const executable = process.env.npm_execpath
  if (executable === undefined || executable === '') {
    if (process.platform === 'win32') throw new Error('npm_execpath is required for Windows pnpm invocation')
    return run('pnpm', args, cwd, timeout)
  }
  return /\.[cm]?js$/iu.test(executable)
    ? run(process.execPath, [executable, ...args], cwd, timeout)
    : run(executable, args, cwd, timeout)
}

describe.skipIf(process.env.DSH_EXAMPLE_MODE !== 'lib')('packed native browser consumer', () => {
  it('installs, imports, and typechecks without Cordis', ({ task }) => {
    const output = mkdtempSync(join(tmpdir(), 'dsh-native-client-consumer-'))
    try {
      const modulesDir = join(root, 'rsh/Programs/Web/client/modules')
      const webDir = join(root, 'rsh/Programs/Web/client/web')
      const archives = [modulesDir, webDir].map((dir) => {
        const packed = JSON.parse(pnpm(['pack', '--json', '--pack-destination', output], dir, task.timeout)) as {
          filename: string
        }
        return resolve(dir, packed.filename)
      })
      writeFileSync(join(output, 'package.json'), '{"name":"native-client-consumer","private":true,"type":"module"}\n')
      pnpm(['add', '--dir', output, '--offline', '--ignore-scripts', ...archives], output, task.timeout)
      expect(existsSync(join(output, 'node_modules/@deepseek-ai/cordis'))).toBe(false)
      const webManifest = JSON.parse(readFileSync(join(output, 'node_modules/@deepseek-ai/dsh-client-web/package.json'), 'utf8')) as {
        peerDependenciesMeta?: Record<string, { optional?: boolean }>
      }
      expect(webManifest.peerDependenciesMeta?.['@deepseek-ai/cordis']?.optional).toBe(true)

      const source = `
        import { registerHooks } from 'node:module'
        registerHooks({ resolve(specifier, context, nextResolve) {
          if (specifier === '@deepseek-ai/cordis' || specifier.startsWith('@deepseek-ai/cordis/')) {
            throw Error('Cordis imported by ' + context.parentURL)
          }
          return nextResolve(specifier, context)
        } })
        const [modules, web] = await Promise.all([
          import('@deepseek-ai/dsh-client-modules/native'),
          import('@deepseek-ai/dsh-client-web/native'),
        ])
        if (typeof modules.ClientModuleSystem !== 'function' || typeof web.bootNativeClient !== 'function') {
          throw Error('native browser exports missing')
        }
      `
      run(process.execPath, ['--input-type=module', '-e', source], output, task.timeout)
      writeFileSync(join(output, 'consumer.mts'), `
        import { ClientModuleSystem } from '@deepseek-ai/dsh-client-modules/native'
        import { bootNativeClient, type NativeClientBootOptions } from '@deepseek-ai/dsh-client-web/native'
        declare const options: NativeClientBootOptions
        void ClientModuleSystem
        void bootNativeClient(options)
      `)
      writeFileSync(join(output, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          target: 'ES2024', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
          lib: ['ES2024', 'DOM'], types: [], skipLibCheck: false, noEmit: true,
        }, files: ['consumer.mts'],
      }))
      const compiler = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc')
      run(process.execPath, [compiler, '--project', join(output, 'tsconfig.json'), '--pretty', 'false'], output, task.timeout)
    } finally {
      const tempRoot = realpathSync(tmpdir())
      const target = realpathSync(output)
      if (!target.startsWith(`${tempRoot}${sep}`) || !basename(target).startsWith('dsh-native-client-consumer-')) {
        throw new Error('refusing to remove an unexpected consumer directory')
      }
      rmSync(target, { recursive: true, force: true })
    }
  }, 90_000)
})

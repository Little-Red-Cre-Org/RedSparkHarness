/** Packed browser-native entries must work in a project without Cordis. */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { execaSync } from 'execa'
import { describe, expect, it } from 'vitest'
import { packedWorkspaceClosure, type WorkspacePackage } from '../../../../../Modules/Official/sandbox/sandbox-local/tests/packed-workspace-closure.ts'

const root = resolve(import.meta.dirname, '../../../../../..')
const require = createRequire(import.meta.url)

function run(command: string, args: string[], cwd: string, timeout: number): string {
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', timeout,
    env: { ...process.env, NODE_OPTIONS: undefined, NODE_PATH: undefined },
  })
  expect(result.error).toBeUndefined()
  expect(result.status, result.stderr || result.stdout).toBe(0)
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

describe.skipIf(process.env.RSH_EXAMPLE_MODE !== 'lib')('packed native browser consumer', () => {
  it('installs, imports, and typechecks without Cordis', ({ task }) => {
    const output = mkdtempSync(join(tmpdir(), 'dsh-native-client-consumer-'))
    try {
      const listed = JSON.parse(pnpm(['list', '--recursive', '--depth', '-1', '--json'], root, task.timeout)) as {
        name: string
        path: string
      }[]
      const workspacePackages = new Map<string, WorkspacePackage>()
      for (const { name, path } of listed) {
        const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')) as Record<string, unknown>
        if (manifest.name !== name) throw new Error(`${path}/package.json does not declare ${name}`)
        workspacePackages.set(name, { name, directory: path, manifest })
      }
      const closure = new Map<string, WorkspacePackage>()
      for (const name of [
        '@redspark/rsh-client-modules', '@redspark/rsh-client-web', '@redspark/rsh-client-store',
      ]) {
        for (const pkg of packedWorkspaceClosure(name, workspacePackages)) closure.set(pkg.name, pkg)
      }
      const archives = [...closure.values()].map(({ directory: dir }) => {
        const packed = JSON.parse(pnpm(['pack', '--json', '--pack-destination', output], dir, task.timeout)) as {
          filename: string
        }
        return resolve(dir, packed.filename)
      })
      writeFileSync(join(output, 'package.json'), '{"name":"native-client-consumer","private":true,"type":"module"}\n')
      execaSync('npm', [
        'install', '--no-audit', '--no-fund', '--include=dev', '--package-lock=false', '--loglevel=error', ...archives,
      ], {
        cwd: output,
        timeout: task.timeout,
        env: { ...process.env, NODE_OPTIONS: undefined, NODE_PATH: undefined },
      })
      expect(existsSync(join(output, 'node_modules/@redspark/cordis'))).toBe(false)
      const webManifest = JSON.parse(readFileSync(join(output, 'node_modules/@redspark/rsh-client-web/package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
        optionalDependencies?: Record<string, string>
        peerDependencies?: Record<string, string>
        exports?: Record<string, unknown>
      }
      expect([
        ...Object.keys(webManifest.dependencies ?? {}),
        ...Object.keys(webManifest.devDependencies ?? {}),
        ...Object.keys(webManifest.optionalDependencies ?? {}),
        ...Object.keys(webManifest.peerDependencies ?? {}),
      ]).not.toContain('@redspark/cordis')
      expect(webManifest.exports?.['./base.css']).toBe('./lib/base.css')
      expect(existsSync(join(output, 'node_modules/@redspark/rsh-client-web/lib/base.css'))).toBe(true)

      const source = `
        import { registerHooks } from 'node:module'
        registerHooks({ resolve(specifier, context, nextResolve) {
          if (specifier === '@redspark/cordis' || specifier.startsWith('@redspark/cordis/')) {
            throw Error('Cordis imported by ' + context.parentURL)
          }
          return nextResolve(specifier, context)
        } })
        const [modules, web, native, store] = await Promise.all([
          import('@redspark/rsh-client-modules/native'),
          import('@redspark/rsh-client-web'),
          import('@redspark/rsh-client-web/native'),
          import('@redspark/rsh-client-store'),
        ])
        if (
          typeof modules.ClientModuleSystem !== 'function' ||
          typeof web.bootNativeClient !== 'function' || typeof native.bootNativeClient !== 'function' ||
          typeof store.createSnapshotStore !== 'function'
        ) {
          throw Error('native browser exports missing')
        }
        const snapshot = store.createSnapshotStore({ count: 0 })
        snapshot.update(draft => { draft.count += 1 })
        if (snapshot.getSnapshot().count !== 1) throw Error('client-store runtime dependencies missing')
      `
      run(process.execPath, ['--input-type=module', '-e', source], output, task.timeout)
      writeFileSync(join(output, 'consumer.mts'), `
        import { ClientModuleSystem } from '@redspark/rsh-client-modules/native'
        import { bootNativeClient as bootFromRoot } from '@redspark/rsh-client-web'
        import { bootNativeClient, type NativeClientBootOptions } from '@redspark/rsh-client-web/native'
        import type { NativeClientBootWire } from '@redspark/rsh-client-web/native-wire'
        import { createSnapshotStore } from '@redspark/rsh-client-store'
        declare const options: NativeClientBootOptions
        declare const wire: NativeClientBootWire
        void ClientModuleSystem
        void bootFromRoot(options)
        void bootNativeClient(options)
        void wire.formatVersion
        void wire.selections
        void createSnapshotStore({ count: 0 }).getSnapshot().count
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
  }, 300_000)
})

import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareNativeClientBundle } from '../src/native-client.ts'

const roots: string[] = []

async function profileRoot(): Promise<{ project: string; runtime: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-host-profile-'))
  roots.push(root)
  const project = join(root, 'project')
  const runtime = join(root, 'runtime')
  await Promise.all([mkdir(project), mkdir(runtime)])
  return { project, runtime }
}

async function installClientPackage(
  root: string,
  packageName: string,
  {
    style = false,
    cordis = false,
    shared = false,
    targets = ['client'],
    manifestName = packageName,
    exportTarget = './native.js',
    manifestValue,
  }: {
    style?: boolean
    cordis?: boolean
    shared?: boolean
    targets?: string[]
    manifestName?: string
    exportTarget?: string
    manifestValue?: unknown
  } = {},
): Promise<void> {
  const packageRoot = join(root, 'node_modules', ...packageName.split('/'))
  await mkdir(packageRoot, { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify(manifestValue ?? {
    name: manifestName,
    type: 'module',
    exports: { './native': exportTarget },
    dsh: { native: {
      apiVersion: 1,
      entry: './native',
      targets,
      requires: [],
      optional: [],
      provides: ['clientRenderer'],
    } },
  }))
  await writeFile(join(packageRoot, 'native.js'), [
    ...(style ? ["import './style.css'"] : []),
    ...(cordis ? ["import { Context } from '@deepseek-ai/cordis'; void Context"] : []),
    ...(shared ? ["import { sharedIdentity } from '@example/dsh-shared'"] : []),
    `export const plugin = { apiVersion: 1, name: "renderer", targets: ["client"], requires: [], provides: ["clientRenderer"], resolve: () => () => {}${shared ? ', shared: sharedIdentity' : ''} }`,
  ].join('\n'))
  if (style) {
    await writeFile(join(packageRoot, 'style.css'), '.native-renderer { color: rebeccapurple; background-image: url(./pixel.png); }')
    await writeFile(join(packageRoot, 'pixel.png'), Uint8Array.from([137, 80, 78, 71]))
  }
}

async function installSharedFixture(root: string): Promise<void> {
  const packageRoot = join(root, 'node_modules', '@example', 'dsh-shared')
  await mkdir(packageRoot, { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
    name: '@example/dsh-shared', type: 'module', exports: './index.js',
  }))
  await writeFile(join(packageRoot, 'index.js'), 'export const sharedIdentity = { marker: "one-copy-only" }')
}

async function installCordisFixture(root: string): Promise<void> {
  const packageRoot = join(root, 'node_modules', ...'@deepseek-ai/cordis'.split('/'))
  await mkdir(packageRoot, { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/cordis', type: 'module', exports: './index.js',
  }))
  await writeFile(join(packageRoot, 'index.js'), 'export class Context {}')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Desktop native Client profile bundling', () => {
  it('returns no bundle when the project has no native Client profile', async () => {
    const { project, runtime } = await profileRoot()
    await expect(prepareNativeClientBundle(project, runtime)).resolves.toBeUndefined()
  })

  it('bundles selected entries and styles from project and runtime installations', async () => {
    const { project, runtime } = await profileRoot()
    await installClientPackage(project, '@example/dsh-renderer', { style: true })
    await installClientPackage(runtime, '@example/dsh-secondary')
    await writeFile(join(project, 'rsh.client.json'), JSON.stringify({
      formatVersion: 1,
      installations: [
        { id: 'renderer', plugin: '@example/dsh-renderer', config: { theme: 'violet' } },
        { id: 'secondary', plugin: '@example/dsh-secondary' },
      ],
    }))

    const bundle = await prepareNativeClientBundle(project, runtime)

    expect(bundle?.wire.modules).toEqual([{ id: 'renderer' }, { id: 'secondary' }])
    expect(bundle?.wire.selections).toEqual([
      { id: 'renderer', config: { theme: 'violet' } },
      { id: 'secondary', config: undefined },
    ])
    expect(bundle?.wire.bundle).toMatch(/^\/.dsh\/native-client\/profile-[\w-]+\.js$/u)
    const script = new TextDecoder().decode(bundle?.assets.get(bundle.wire.bundle)?.body)
    expect(script).toContain('renderer')
    expect(script).toContain('secondary')
    expect(bundle?.wire.styles).toHaveLength(1)
    expect(bundle?.wire.styles[0]).toMatch(/^\/.dsh\/native-client\/.*\.css\?v=[a-f0-9]{16}$/u)
    const stylePath = bundle?.wire.styles[0]?.split('?')[0]
    expect(bundle?.assets.get(stylePath ?? '')?.contentType).toBe('text/css; charset=utf-8')
    expect([...(bundle?.assets.values() ?? [])].some(asset => asset.contentType === 'application/octet-stream')).toBe(true)
  })

  it('bundles shared dependencies once across selected entries', async () => {
    const { project, runtime } = await profileRoot()
    await installSharedFixture(project)
    await installClientPackage(project, '@example/dsh-first', { shared: true })
    await installClientPackage(project, '@example/dsh-second', { shared: true })
    await writeFile(join(project, 'rsh.client.json'), JSON.stringify({
      formatVersion: 1,
      installations: [
        { id: 'first', plugin: '@example/dsh-first' },
        { id: 'second', plugin: '@example/dsh-second' },
      ],
    }))

    const bundle = await prepareNativeClientBundle(project, runtime)
    const script = new TextDecoder().decode(bundle?.assets.get(bundle.wire.bundle)?.body)
    expect([...script.matchAll(/one-copy-only/gu)]).toHaveLength(1)
  })

  it('rejects an invalid profile before resolving its packages', async () => {
    const { project, runtime } = await profileRoot()
    await writeFile(join(project, 'rsh.client.json'), JSON.stringify({
      formatVersion: 1,
      installations: [{ id: 'renderer', plugin: '../outside' }],
    }))

    await expect(prepareNativeClientBundle(project, runtime)).rejects.toThrow(
      'native Client installation renderer has invalid package name',
    )
  })

  it.each([
    { label: 'non-object root', value: null, message: 'native Client profile must be an object' },
    { label: 'unknown profile field', value: { formatVersion: 1, installations: [], extra: true }, message: 'native Client profile has unknown field extra' },
    { label: 'unsupported format', value: { formatVersion: 2, installations: [] }, message: 'native Client profile has unsupported formatVersion' },
    { label: 'empty installation list', value: { formatVersion: 1, installations: [] }, message: 'native Client profile must select at least one installation' },
    { label: 'non-array installation list', value: { formatVersion: 1, installations: {} }, message: 'native Client profile must select at least one installation' },
    { label: 'unknown installation field', value: { formatVersion: 1, installations: [{ id: 'renderer', plugin: '@example/dsh-renderer', extra: true }] }, message: 'native Client installation has unknown field extra' },
    { label: 'empty installation id', value: { formatVersion: 1, installations: [{ id: '', plugin: '@example/dsh-renderer' }] }, message: 'native Client installation id must be a nonempty string' },
    { label: 'empty package name', value: { formatVersion: 1, installations: [{ id: 'renderer', plugin: '' }] }, message: 'native Client installation renderer plugin must be a nonempty string' },
    { label: 'duplicate installation ids', value: { formatVersion: 1, installations: [{ id: 'renderer', plugin: '@example/dsh-renderer' }, { id: 'renderer', plugin: '@example/dsh-secondary' }] }, message: 'native Client profile repeats an installation id' },
  ])('rejects $label before resolving packages', async ({ value, message }) => {
    const { project, runtime } = await profileRoot()
    await writeFile(join(project, 'rsh.client.json'), JSON.stringify(value))

    await expect(prepareNativeClientBundle(project, runtime)).rejects.toThrow(
      `cannot load rsh.client.json: Error: dsh desktop: ${message}`,
    )
  })

  it('rejects malformed profile JSON', async () => {
    const { project, runtime } = await profileRoot()
    await writeFile(join(project, 'rsh.client.json'), '{')

    await expect(prepareNativeClientBundle(project, runtime)).rejects.toThrow('cannot load rsh.client.json: SyntaxError:')
  })

  it('rejects a selected package that is not installed in the project or runtime', async () => {
    const { project, runtime } = await profileRoot()
    await writeFile(join(project, 'rsh.client.json'), JSON.stringify({
      formatVersion: 1,
      installations: [{ id: 'renderer', plugin: '@example/dsh-missing' }],
    }))

    await expect(prepareNativeClientBundle(project, runtime)).rejects.toThrow(
      'native Client installation renderer package @example/dsh-missing is not installed in the profile or runtime',
    )
  })

  it('handles built-in names without package search paths', async () => {
    const { project, runtime } = await profileRoot()
    await writeFile(join(project, 'rsh.client.json'), JSON.stringify({
      formatVersion: 1,
      installations: [{ id: 'filesystem', plugin: 'fs' }],
    }))

    await expect(prepareNativeClientBundle(project, runtime)).rejects.toThrow(
      'native Client installation filesystem package fs is not installed in the profile or runtime',
    )
  })

  it('rejects a package resolved outside the profile and runtime roots', async () => {
    const { project, runtime } = await profileRoot()
    const outside = join(project, '..', 'external-packages')
    await installClientPackage(outside, '@example/dsh-renderer')
    const link = join(project, 'node_modules', '@example', 'dsh-renderer')
    await mkdir(join(project, 'node_modules', '@example'), { recursive: true })
    await symlink(join(outside, 'node_modules', '@example', 'dsh-renderer'), link,
      process.platform === 'win32' ? 'junction' : 'dir')
    await writeFile(join(project, 'rsh.client.json'), JSON.stringify({
      formatVersion: 1,
      installations: [{ id: 'renderer', plugin: '@example/dsh-renderer' }],
    }))

    await expect(prepareNativeClientBundle(project, runtime)).rejects.toThrow(
      'native Client installation renderer package @example/dsh-renderer is not installed in the profile or runtime',
    )
  })

  it('rejects mismatched package identity and a Host-only entry', async () => {
    const { project, runtime } = await profileRoot()
    await installClientPackage(project, '@example/dsh-wrong-name', { manifestName: '@example/dsh-other-name' })
    await installClientPackage(runtime, '@example/dsh-host-only', { targets: ['host'] })
    await writeFile(join(project, 'rsh.client.json'), JSON.stringify({
      formatVersion: 1,
      installations: [
        { id: 'wrong-name', plugin: '@example/dsh-wrong-name' },
        { id: 'host-only', plugin: '@example/dsh-host-only' },
      ],
    }))

    await expect(prepareNativeClientBundle(project, runtime)).rejects.toThrow(
      'native Client installation wrong-name package identity differs',
    )
    await writeFile(join(project, 'rsh.client.json'), JSON.stringify({
      formatVersion: 1,
      installations: [{ id: 'host-only', plugin: '@example/dsh-host-only' }],
    }))
    await expect(prepareNativeClientBundle(project, runtime)).rejects.toThrow(
      '@example/dsh-host-only does not support client',
    )
  })

  it('rejects package manifests that are not objects or do not declare a native entry', async () => {
    const { project, runtime } = await profileRoot()
    await installClientPackage(project, '@example/dsh-null-manifest', { manifestValue: null })
    const nullManifest = join(project, 'node_modules', '@example', 'dsh-null-manifest', 'package.json')
    await writeFile(nullManifest, 'null')
    await writeFile(join(project, 'rsh.client.json'), JSON.stringify({
      formatVersion: 1,
      installations: [{ id: 'null-manifest', plugin: '@example/dsh-null-manifest' }],
    }))
    await expect(prepareNativeClientBundle(project, runtime)).rejects.toThrow('invalid package manifest')

    await installClientPackage(project, '@example/dsh-invalid-manifest', {
      manifestValue: { name: '@example/dsh-invalid-manifest', exports: 'invalid', dsh: [] },
    })
    await writeFile(join(project, 'rsh.client.json'), JSON.stringify({
      formatVersion: 1,
      installations: [{ id: 'invalid-manifest', plugin: '@example/dsh-invalid-manifest' }],
    }))
    await expect(prepareNativeClientBundle(project, runtime)).rejects.toThrow(
      'native-runtime: native manifest must be an object',
    )

    await installClientPackage(project, '@example/dsh-missing-native', {
      manifestValue: { name: '@example/dsh-missing-native', exports: { './native': './native.js' }, dsh: {} },
    })
    await writeFile(join(project, 'rsh.client.json'), JSON.stringify({
      formatVersion: 1,
      installations: [{ id: 'missing-native', plugin: '@example/dsh-missing-native' }],
    }))
    await expect(prepareNativeClientBundle(project, runtime)).rejects.toThrow(
      'native-runtime: native manifest must be an object',
    )
  })

  it('rejects package identities whose manifest name is not a string', async () => {
    const { project, runtime } = await profileRoot()
    await installClientPackage(project, '@example/dsh-renderer', {
      manifestValue: {
        name: 1,
        exports: { './native': './native.js' },
        dsh: { native: {
          apiVersion: 1,
          entry: './native',
          targets: ['client'],
          requires: [],
          optional: [],
          provides: ['clientRenderer'],
        } },
      },
    })
    await writeFile(join(project, 'rsh.client.json'), JSON.stringify({
      formatVersion: 1,
      installations: [{ id: 'renderer', plugin: '@example/dsh-renderer' }],
    }))

    await expect(prepareNativeClientBundle(project, runtime)).rejects.toThrow(
      'native Client installation renderer package identity differs',
    )
  })

  it('rejects an exported native entry that resolves outside its package', async () => {
    const { project, runtime } = await profileRoot()
    const packageName = '@example/dsh-renderer'
    await installClientPackage(project, packageName, { exportTarget: './entry/native.js' })
    const packageRoot = join(project, 'node_modules', ...packageName.split('/'))
    const outside = join(project, 'external-entry')
    await mkdir(outside)
    await writeFile(join(outside, 'native.js'), 'export const plugin = {}')
    await symlink(outside, join(packageRoot, 'entry'), process.platform === 'win32' ? 'junction' : 'dir')
    await writeFile(join(project, 'rsh.client.json'), JSON.stringify({
      formatVersion: 1,
      installations: [{ id: 'renderer', plugin: packageName }],
    }))

    await expect(prepareNativeClientBundle(project, runtime)).rejects.toThrow(
      'native Client installation renderer entry escapes its package',
    )
  })

  it('rejects client packages whose browser graph imports Cordis', async () => {
    const { project, runtime } = await profileRoot()
    await installCordisFixture(project)
    await installClientPackage(project, '@example/dsh-renderer', { cordis: true })
    await writeFile(join(project, 'rsh.client.json'), JSON.stringify({
      formatVersion: 1,
      installations: [{ id: 'renderer', plugin: '@example/dsh-renderer' }],
    }))

    await expect(prepareNativeClientBundle(project, runtime)).rejects.toThrow(
      /native Client bundle imports Cordis/u,
    )
  })
})

/** Installed Desktop selection cannot use the source-development workspace allowance. */
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { prepareNativeClientBundle } from '../src/native-client.ts'

it('keeps workspace Client resolution explicit and rejects installed package escapes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'rsh-installed-client-'))
  const project = join(home, 'profile'), runtime = join(home, 'runtime')
  const source = join(home, 'source'), link = join(runtime, 'node_modules', 'fixture-client')
  try {
    await mkdir(project)
    await mkdir(source)
    await mkdir(join(runtime, 'node_modules'), { recursive: true })
    await writeFile(join(home, 'pnpm-workspace.yaml'), 'packages: []\n')
    await writeFile(join(source, 'package.json'), JSON.stringify({
      name: 'fixture-client', type: 'module', exports: { './native': './native.mjs' },
      dsh: { native: { apiVersion: 1, entry: './native', targets: ['client'], requires: [], optional: [], provides: [] } },
    }))
    await writeFile(join(source, 'native.mjs'), 'export const plugin = { apiVersion: 1, name: "fixture-client", targets: ["client"], requires: [], provides: [], resolve: () => () => {} }\n')
    await symlink(source, link, process.platform === 'win32' ? 'junction' : 'dir')
    await writeFile(join(project, 'rsh.client.json'), JSON.stringify({
      formatVersion: 1, installations: [{ id: 'client', plugin: 'fixture-client' }],
    }))
    expect((await prepareNativeClientBundle(project, runtime))?.wire.modules).toEqual([{ id: 'client' }])
    await expect(prepareNativeClientBundle(project, runtime, true)).rejects.toThrow('not installed in the profile or runtime')
    await unlink(link)
    await mkdir(link)
    const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')) as { exports: Record<string, string> }
    manifest.exports['./native'] = './entry/native.mjs'
    await writeFile(join(link, 'package.json'), JSON.stringify(manifest))
    await symlink(source, join(link, 'entry'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(prepareNativeClientBundle(project, runtime, true)).rejects.toThrow('entry escapes its package')
    await unlink(join(link, 'entry'))
    const installed = join(runtime, 'node_modules', 'contained-client')
    await mkdir(installed)
    await writeFile(join(installed, 'package.json'), JSON.stringify({ ...manifest, name: 'contained-client', exports: { './native': './native.mjs' } }))
    await writeFile(join(installed, 'native.mjs'), (await readFile(join(source, 'native.mjs'), 'utf8')).replace('fixture-client', 'contained-client'))
    await writeFile(join(project, 'rsh.client.json'), JSON.stringify({ formatVersion: 1, installations: [{ id: 'client', plugin: 'contained-client' }] }))
    expect((await prepareNativeClientBundle(project, runtime, true))?.wire.modules).toEqual([{ id: 'client' }])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

it('defines only public Client environment values and fixes the browser bundle to production', async () => {
  const home = await mkdtemp(join(tmpdir(), 'rsh-native-client-env-'))
  const project = join(home, 'profile'), runtime = join(home, 'runtime')
  const fixture = join(runtime, 'node_modules', 'native-env-fixture')
  vi.stubEnv('DSH_CLIENT_TITLE', 'Native browser shell')
  vi.stubEnv('DSH_CLIENT_UNSET', undefined)
  vi.stubEnv('DSH_HOST_SECRET', 'host-only')
  vi.stubEnv('NODE_ENV', 'development')
  try {
    await mkdir(project, { recursive: true })
    await mkdir(fixture, { recursive: true })
    await writeFile(join(fixture, 'package.json'), JSON.stringify({
      name: 'native-env-fixture', type: 'module', exports: { './native': './native.mjs' },
      dsh: { native: { apiVersion: 1, entry: './native', targets: ['client'], requires: [], optional: [], provides: [] } },
    }))
    await writeFile(join(fixture, 'native.mjs'), [
      'export const environment = {',
      '  title: process.env.DSH_CLIENT_TITLE,',
      '  missing: process.env.DSH_CLIENT_UNSET,',
      '  secret: process.env.DSH_HOST_SECRET,',
      '  all: process.env,',
      '  nodeEnv: process.env.NODE_ENV,',
      '}',
    ].join('\n'))
    await writeFile(join(project, 'rsh.client.json'), JSON.stringify({
      formatVersion: 1, installations: [{ id: 'client', plugin: 'native-env-fixture' }],
    }))

    const bundle = await prepareNativeClientBundle(project, runtime)
    const asset = bundle?.assets.get(bundle.wire.bundle)
    expect(asset?.contentType).toBe('text/javascript; charset=utf-8')
    const module = await import(`data:text/javascript;base64,${Buffer.from(asset!.body).toString('base64')}`) as {
      plugins: {
        client: {
          environment: {
            title: string
            missing: undefined
            secret: undefined
            all: Record<string, never>
            nodeEnv: string
          }
        }
      }
    }
    expect(module.plugins.client.environment).toEqual({
      title: 'Native browser shell', missing: undefined, secret: undefined, all: {}, nodeEnv: 'production',
    })
  } finally {
    vi.unstubAllEnvs()
    await rm(home, { recursive: true, force: true })
  }
})

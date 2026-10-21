import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { prepareNativeClientBundle, type NativeClientBundle } from '@deepseek-ai/dsh-native-web-assets'
import { NativeClientReloader } from '../src/client-reload.ts'

it('publishes a source edit, keeps the last good bundle on failure and drains shutdown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rsh-client-reload-'))
  const project = join(root, 'project'), runtime = join(root, 'runtime')
  const pkg = join(project, 'node_modules', '@example', 'renderer')
  await Promise.all([mkdir(pkg, { recursive: true }), mkdir(runtime)])
  await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@example/renderer', type: 'module',
    exports: { './native': './native.js' }, dsh: { native: {
      apiVersion: 1, entry: './native', targets: ['client'], requires: [], optional: [], provides: [],
    } },
  }))
  const source = join(pkg, 'native.js')
  await writeFile(source, 'export const version = 1')
  await writeFile(join(project, 'rsh.client.json'), JSON.stringify({ formatVersion: 1,
    installations: [{ id: 'renderer', plugin: '@example/renderer' }],
  }))
  const initial = await prepareNativeClientBundle(project, runtime)
  if (initial === undefined) throw new Error('Selected profile produced no bundle')
  let published: NativeClientBundle = initial
  const report = vi.fn()
  const reloader = new NativeClientReloader(initial,
    () => prepareNativeClientBundle(project, runtime),
    (candidate) => { published = candidate }, report)
  try {
    await reloader.ready()
    await writeFile(source, 'export const version = 2')
    await vi.waitFor(() => { expect(published.wire.bundle).not.toBe(initial.wire.bundle) })
    const working = published
    await writeFile(source, 'export const version = (')
    await vi.waitFor(() => { expect(report).toHaveBeenCalled() })
    expect(published).toBe(working)
    await writeFile(source, "export { version } from './created/value.js'")
    await vi.waitFor(() => { expect(report.mock.calls.length).toBeGreaterThan(1) })
    await mkdir(join(pkg, 'created'))
    await writeFile(join(pkg, 'created', 'value.js'), 'export const version = 3')
    await vi.waitFor(() => { expect(published.wire.bundle).not.toBe(working.wire.bundle) })
    const recovered = published
    await writeFile(source, "export { version } from '@example/dep'")
    await vi.waitFor(() => { expect(report.mock.calls.length).toBeGreaterThan(2) })
    expect(published).toBe(recovered)
    const dependency = join(project, 'node_modules', '@example', 'dep')
    await mkdir(dependency)
    await writeFile(join(dependency, 'package.json'), JSON.stringify({ name: '@example/dep', type: 'module',
      exports: './index.js',
    }))
    await writeFile(join(dependency, 'index.js'), 'export const version = 4')
    await vi.waitFor(() => { expect(published.wire.bundle).not.toBe(recovered.wire.bundle) })
    const restored = published
    const closing = reloader.close()
    expect(reloader.close()).toBe(closing)
    await closing
    await writeFile(source, 'export const version = 3')
    await reloader.refresh()
    expect(published).toBe(restored)
  } finally {
    await reloader.close()
    await rm(root, { recursive: true, force: true })
  }
})

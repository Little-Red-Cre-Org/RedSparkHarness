import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { runDesktopHost } from '../src/index.ts'

const roots: { root: string; links: string[] }[] = []

async function fixture(linked: readonly string[] = []): Promise<{
  project: string
  runtime: string
  enteredPath: string
  abortedPath: string
  disposedPath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-native-host-'))
  const links: string[] = []
  roots.push({ root, links })
  const project = join(root, 'project')
  const runtime = join(root, 'runtime')
  const enteredPath = join(root, 'request-entered')
  const abortedPath = join(root, 'request-aborted')
  const disposedPath = join(root, 'host-disposed')
  const cli = join(root, 'workspace', 'apps', 'cli')
  const workspace = join(root, 'workspace')
  await Promise.all([mkdir(project), mkdir(runtime), mkdir(cli, { recursive: true })])
  await writeFile(join(workspace, 'pnpm-workspace.yaml'), 'packages: []\n')
  await writeFile(join(cli, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '1.0.0', type: 'module' }))
  await writeFile(join(runtime, 'package.json'), '{}')
  await mkdir(join(runtime, 'node_modules', '@deepseek-ai'), { recursive: true })
  const dshLink = join(runtime, 'node_modules', '@deepseek-ai', 'dsh')
  await symlink(cli, dshLink, process.platform === 'win32' ? 'junction' : 'dir')
  links.push(dshLink)
  const frontend = join(runtime, 'node_modules', '@deepseek-ai', 'dsh-web-frontend')
  await mkdir(join(frontend, 'dist'), { recursive: true })
  await writeFile(join(frontend, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-web-frontend',
    exports: { './dist/native.html': './dist/native.html' },
  }))
  await writeFile(join(frontend, 'dist', 'native.html'), '<!doctype html><html><head></head><body>native fixture</body></html>')
  await writeFile(join(project, 'package.json'), JSON.stringify({
    name: 'desktop-native-fixture',
    private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json', configReload: 'startup' } },
  }))
  await writeFile(join(project, 'rsh.profile.json'), JSON.stringify({
    formatVersion: 1,
    scopes: [{ id: 'root' }],
    installations: [
      { id: 'credentials', plugin: '@fixture/dsh-credentials', scope: 'root' },
      { id: 'host', plugin: '@fixture/dsh-host', scope: 'root' },
    ],
  }))
  await writeFile(join(project, 'rsh.client.json'), JSON.stringify({
    formatVersion: 1,
    installations: [{ id: 'client', plugin: '@fixture/dsh-client' }],
  }))

  const packages = [
    {
      name: '@fixture/dsh-credentials',
      manifest: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], provides: ['credentials'] },
      source: 'const records = new Map();\nexport const plugin = { apiVersion: 1, name: "@fixture/dsh-credentials", targets: ["host"], requires: [], provides: ["credentials"], resolve: () => context => context.provide("credentials", { async modifyRecord(key, mutate) { const next = await mutate(records.get(key)); if (next === undefined) records.delete(key); else records.set(key, next); return next } }) };\n',
    },
    {
      name: '@fixture/dsh-host',
      manifest: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['hostConnection'], provides: ['nativeWebSession'] },
      source: [
        'import { writeFileSync } from "node:fs";',
        `const enteredPath = ${JSON.stringify(enteredPath)};`,
        `const abortedPath = ${JSON.stringify(abortedPath)};`,
        `const disposedPath = ${JSON.stringify(disposedPath)};`,
        'export const plugin = { apiVersion: 1, name: "@fixture/dsh-host", targets: ["host"], requires: ["hostConnection"], provides: ["nativeWebSession"], resolve: () => context => { const dispose = context.require("hostConnection").fetch.register({ path: "/api/test", methods: ["GET"], requestBody: "buffered", fetch: request => { if (!new URL(request.url).searchParams.has("wait")) return Promise.resolve(new Response("api fixture")); writeFileSync(enteredPath, "entered"); return new Promise(resolve => request.signal.addEventListener("abort", () => { writeFileSync(abortedPath, "aborted"); resolve(new Response("aborted", { status: 499 })) }, { once: true })) } }); context.own(async () => { await dispose(); writeFileSync(disposedPath, "disposed") }); context.provide("nativeWebSession", {}) } };',
        '',
      ].join('\n'),
    },
    {
      name: '@fixture/dsh-client',
      manifest: { apiVersion: 1, entry: './native', targets: ['client'], requires: [], provides: ['clientRenderer'] },
      source: 'export const plugin = { apiVersion: 1, name: "@fixture/dsh-client", targets: ["client"], requires: [], provides: ["clientRenderer"], resolve: () => () => {} };\n',
    },
  ]
  for (const row of packages) {
    const source = join(linked.includes(row.name) ? join(workspace, 'packages') : join(project, 'node_modules'), ...row.name.split('/'))
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'package.json'), JSON.stringify({
      name: row.name,
      type: 'module',
      exports: { './package.json': './package.json', './native': './native.js' },
      dsh: { native: { ...row.manifest, optional: [] } },
    }))
    await writeFile(join(source, 'native.js'), row.source)
    if (linked.includes(row.name)) {
      const link = join(project, 'node_modules', ...row.name.split('/'))
      await mkdir(join(link, '..'), { recursive: true })
      await symlink(source, link, process.platform === 'win32' ? 'junction' : 'dir')
      links.push(link)
    }
  }
  return { project, runtime, enteredPath, abortedPath, disposedPath }
}

function decode(frames: readonly Buffer[]): { type: number; streamId: number; payload: Buffer }[] {
  return frames.map(frame => ({
    type: frame.readUInt8(4),
    streamId: frame.readUInt32BE(5),
    payload: frame.subarray(13),
  }))
}

function command(streamId: number, url: string) {
  return { streamId, request: { url, method: 'GET', headers: [] as [string, string][] } }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async ({ root, links }) => {
    await Promise.all(links.map(link => unlink(link)))
    await rm(root, { recursive: true, force: true })
  }))
})

it('streams the API route and native index as start, data, and end frames', async () => {
  const { project, runtime } = await fixture()
  const output: Buffer[] = []
  const host = await runDesktopHost(runtime, project, async (frame) => { output.push(frame) })
  try {
    await host.fetch(command(1, 'dsh-app://app/api/test'), null)
    await host.fetch(command(2, 'dsh-app://app/'), null)
    const frames = decode(output)
    for (const streamId of [1, 2]) {
      expect(frames.filter(frame => frame.streamId === streamId).map(frame => frame.type)).toEqual([1, 2, 3])
      expect(JSON.parse(frames.find(frame => frame.streamId === streamId && frame.type === 1)!.payload.toString()))
        .toMatchObject({ status: 200, hasBody: true })
    }
    expect(frames.find(frame => frame.streamId === 1 && frame.type === 2)?.payload.toString()).toBe('api fixture')
    expect(frames.find(frame => frame.streamId === 2 && frame.type === 2)?.payload.toString()).toContain('native fixture')
  } finally {
    await host.dispose()
  }
})

it('cancels a route request and drains active work during Host stop', async () => {
  const { project, runtime, enteredPath, abortedPath, disposedPath } = await fixture()
  const output: Buffer[] = []
  const host = await runDesktopHost(runtime, project, async (frame) => { output.push(frame) })
  let cancelledRequest: Promise<void> | undefined
  let stoppedRequest: Promise<void> | undefined
  try {
    cancelledRequest = host.fetch(command(3, 'dsh-app://app/api/test?wait'), null)
    await vi.waitFor(async () => { await expect(readFile(enteredPath, 'utf8')).resolves.toBe('entered') })
    host.cancel(3)
    await cancelledRequest
    expect(await readFile(abortedPath, 'utf8')).toBe('aborted')
    expect(decode(output).some(frame => frame.type === 4)).toBe(false)

    await Promise.all([rm(enteredPath, { force: true }), rm(abortedPath, { force: true })])
    stoppedRequest = host.fetch(command(4, 'dsh-app://app/api/test?wait'), null)
    await vi.waitFor(async () => { await expect(readFile(enteredPath, 'utf8')).resolves.toBe('entered') })
    await host.dispose()
    expect(await readFile(disposedPath, 'utf8')).toBe('disposed')
    await stoppedRequest
    expect(await readFile(abortedPath, 'utf8')).toBe('aborted')
  } finally {
    try {
      await host.dispose()
    } finally {
      await cancelledRequest
      await stoppedRequest
    }
  }
})

it('allows workspace-linked native packages only when explicitly enabled', async () => {
  const rejected = await fixture(['@fixture/dsh-host'])
  await expect(runDesktopHost(rejected.runtime, rejected.project, async () => {}))
    .rejects.toMatchObject({
      message: 'native installation host: invalid package @fixture/dsh-host',
      cause: { message: 'package identity differs or package is outside the installed profile/runtime' },
    })
  const { project, runtime } = await fixture(['@fixture/dsh-credentials', '@fixture/dsh-host', '@fixture/dsh-client'])
  const output: Buffer[] = []
  const host = await runDesktopHost(runtime, project, async (frame) => { output.push(frame) }, { allowLinkedPackages: true })
  try {
    await host.fetch(command(5, 'dsh-app://app/api/test'), null)
    const frames = decode(output).filter(frame => frame.streamId === 5)
    expect(JSON.parse(frames.find(frame => frame.type === 1)!.payload.toString())).toMatchObject({ status: 200 })
    expect(Buffer.concat(frames.filter(frame => frame.type === 2).map(frame => frame.payload)).toString()).toBe('api fixture')
  } finally {
    await host.dispose()
  }
})

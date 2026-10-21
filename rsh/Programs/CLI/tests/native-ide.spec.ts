import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeIde } from '@deepseek-ai/dsh-ide-code-oss'
import { plugin as ide } from '@deepseek-ai/dsh-ide-code-oss/native'
import { plugin as subprocess } from '@deepseek-ai/dsh-subprocess-local/native'
import { shippedNativeProfileComposition } from '../src/native-profile-template.ts'

it.each(['ready', 'early-exit', 'install-error', 'invalid-port'] as const)('native IDE owns process and token cleanup after %s', async (mode) => {
  const home = await mkdtemp(join(tmpdir(), 'rsh-native-ide-'))
  const runtime = join(home, 'ide', 'runtime')
  const data = join(home, 'ide', 'data')
  let host: NativeHost | undefined
  const occupied = createServer()
  try {
    await mkdir(join(runtime, 'out'), { recursive: true })
    await copyFile(process.execPath, join(runtime, process.platform === 'win32' ? 'node.exe' : 'node'))
    await writeFile(join(runtime, 'out', 'server-main.js'), `
      const http = require('node:http');
      const fs = require('node:fs');
      const marker = require('node:path').join(__dirname, 'installed');
      if (process.argv.includes('--install-extension')) {
        if (${JSON.stringify(mode)} === 'install-error') process.exit(9);
        fs.writeFileSync(marker, 'ready');
        process.exit(0);
      }
      if (!fs.existsSync(marker)) process.exit(8);
      if (${JSON.stringify(mode)} === 'early-exit') process.exit(7);
      const token = fs.readFileSync(process.argv[process.argv.indexOf('--connection-token-file') + 1], 'utf8');
      const server = http.createServer((req, res) => {
        res.statusCode = new URL(req.url, 'http://localhost').searchParams.get('tkn') === token ? 200 : 403;
        res.end('workspace');
      });
      server.listen(Number(process.argv[process.argv.indexOf('--port') + 1]), '127.0.0.1', () => console.log('Extension host agent listening on ' + server.address().port));
    `)
    const profile = shippedNativeProfileComposition(home, 'native-ide')
    expect(profile.installations.map(row => row.plugin)).toEqual([
      '@deepseek-ai/dsh-native-ide', '@deepseek-ai/dsh-ide-code-oss', '@deepseek-ai/dsh-subprocess-local',
    ])
    let service: NativeIde | undefined
    const capture: NativePlugin = {
      apiVersion: 1, name: 'test-ide-consumer', targets: ['host'], requires: ['ide'], provides: [],
      resolve: () => (context) => { service = context.require('ide') },
    }
    const startHost = (): NativeHost => {
      const scope = new NativeScope()
      return new NativeHost(resolveInstallation([
        { plugin: subprocess, scope, config: undefined },
        { plugin: ide, scope, config: { ...profile.installations.find(row => row.id === 'ide')?.config as object,
          builtinExtension: join(home, 'test.vsix') } },
        { plugin: capture, scope, config: undefined },
      ], 'host'))
    }
    if (mode === 'invalid-port') {
      await mkdir(data, { recursive: true })
      await writeFile(join(data, 'server-port'), 'not-a-port')
    }
    host = startHost()
    if (mode !== 'ready') {
      const error = mode === 'invalid-port' ? /number/i : mode === 'install-error' ? 'IDE extension installation failed (code 9)' : 'IDE server exited before readiness (code 7)'
      await expect(host.start()).rejects.toThrow(error)
      await expect(host.stop()).rejects.toThrow(error)
      host = undefined
    } else {
      await host.start()
      if (service === undefined) throw new Error('IDE was not published')
      const workspacePath = new URL(service.url).searchParams.get('workspace')
      expect(workspacePath).toMatch(/\/RedSpark\.code-workspace$/)
      const workspaceFile = process.platform === 'win32' ? workspacePath!.slice(1) : workspacePath!
      expect(JSON.parse(await readFile(workspaceFile, 'utf8'))).toEqual({ folders: [{ path: process.cwd() }] })
      const response = await fetch(service.url)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('workspace')
      const first = new URL(service.url)
      const edited = { folders: [{ path: process.cwd() }], settings: { 'editor.fontSize': 19 } }
      await writeFile(workspaceFile, JSON.stringify(edited))
      await host.stop()
      await expect(fetch(service.url)).rejects.toThrow()
      host = startHost()
      await host.start()
      const next = new URL(service.url)
      expect(next.origin).toBe(first.origin)
      expect(next.searchParams.get('workspace')).toBe(workspacePath)
      expect(next.searchParams.get('tkn')).not.toBe(first.searchParams.get('tkn'))
      expect(JSON.parse(await readFile(workspaceFile, 'utf8'))).toEqual(edited)
      expect((await fetch(first)).status).toBe(403)
      expect((await fetch(next)).status).toBe(200)
      await host.stop()
      occupied.listen(Number(next.port), '127.0.0.1')
      await once(occupied, 'listening')
      host = startHost()
      await expect(host.start()).rejects.toThrow('IDE server exited before readiness')
      await expect(host.stop()).rejects.toThrow('IDE server exited before readiness')
      host = undefined
      expect(await readFile(join(data, 'server-port'), 'utf8')).toBe(`${next.port}\n`)
    }
    expect((await readdir(data)).filter(name => name.startsWith('.connection-'))).toEqual([])
  } finally {
    await host?.stop()
    if (occupied.listening) await new Promise<void>((resolve, reject) => {
      occupied.close((error) => { if (error === undefined) resolve(); else reject(error) })
    })
    await rm(home, { recursive: true, force: true })
  }
}, 15000)

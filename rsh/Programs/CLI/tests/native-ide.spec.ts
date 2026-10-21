import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeIde } from '@deepseek-ai/dsh-ide-code-oss'
import { plugin as ide } from '@deepseek-ai/dsh-ide-code-oss/native'
import { plugin as subprocess } from '@deepseek-ai/dsh-subprocess-local/native'
import { shippedNativeProfileComposition } from '../src/native-profile-template.ts'

it.each(['ready', 'early-exit'] as const)('native IDE owns process and token cleanup after %s', async (mode) => {
  const home = await mkdtemp(join(tmpdir(), 'rsh-native-ide-'))
  const runtime = join(home, 'ide', 'runtime')
  const data = join(home, 'ide', 'data')
  let host: NativeHost | undefined
  try {
    await mkdir(join(runtime, 'out'), { recursive: true })
    await copyFile(process.execPath, join(runtime, process.platform === 'win32' ? 'node.exe' : 'node'))
    await writeFile(join(runtime, 'out', 'server-main.js'), mode === 'early-exit' ? 'process.exit(7)' : `
      const http = require('node:http');
      const fs = require('node:fs');
      const token = fs.readFileSync(process.argv[process.argv.indexOf('--connection-token-file') + 1], 'utf8');
      const server = http.createServer((req, res) => {
        res.statusCode = new URL(req.url, 'http://localhost').searchParams.get('tkn') === token ? 200 : 403;
        res.end('workspace');
      });
      server.listen(0, '127.0.0.1', () => console.log('Extension host agent listening on ' + server.address().port));
    `)
    const profile = shippedNativeProfileComposition(home, 'native-ide')
    expect(profile.installations.map(row => row.plugin)).toEqual([
      '@deepseek-ai/dsh-native-ide', '@deepseek-ai/dsh-ide-code-oss', '@deepseek-ai/dsh-subprocess-local',
    ])
    const scope = new NativeScope()
    let service: NativeIde | undefined
    const capture: NativePlugin = {
      apiVersion: 1, name: 'test-ide-consumer', targets: ['host'], requires: ['ide'], provides: [],
      resolve: () => (context) => { service = context.require('ide') },
    }
    host = new NativeHost(resolveInstallation([
      { plugin: subprocess, scope, config: undefined },
      { plugin: ide, scope, config: profile.installations.find(row => row.id === 'ide')?.config },
      { plugin: capture, scope, config: undefined },
    ], 'host'))
    if (mode === 'early-exit') {
      await expect(host.start()).rejects.toThrow('IDE server exited before readiness (code 7)')
      await expect(host.stop()).rejects.toThrow('IDE server exited before readiness (code 7)')
      host = undefined
    } else {
      await host.start()
      if (service === undefined) throw new Error('IDE was not published')
      expect(new URL(service.url).searchParams.get('folder')).toBe(process.cwd().replaceAll('\\', '/'))
      const response = await fetch(service.url)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('workspace')
      await host.stop()
      await expect(fetch(service.url)).rejects.toThrow()
    }
    expect((await readdir(data)).filter(name => name.startsWith('.connection-'))).toEqual([])
  } finally {
    await host?.stop()
    await rm(home, { recursive: true, force: true })
  }
}, 15000)

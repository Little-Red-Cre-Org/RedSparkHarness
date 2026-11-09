/** End-to-end: a Native profile resolves its agentDefaultModel row through the loader. */
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

describe('native default model wiring', () => {
  it('resolves the agentDefaultModel row through the profile loader', async () => {
    const home = mkdtempSync(join(tmpdir(), 'native-default-model-'))
    try {
      const profile = join(home, 'profiles/native-headless')
      mkdirSync(profile, { recursive: true })
      writeFileSync(join(profile, 'rsh.profile.json'),
        JSON.stringify(shippedNativeProfileComposition(home, 'native-headless')))
      copyFileSync(join(root, 'rsh/Programs/CLI/tests/profiles/native-headless/package.json'),
        join(profile, 'package.json'))
      const modules = join(profile, 'node_modules/@redspark')
      mkdirSync(modules, { recursive: true })
      // Only the two rows under test need to resolve for this check.
      symlinkSync(join(root, 'rsh/Engine/core/agent-default-model'), join(modules, 'rsh-agent-default-model'), 'junction')

      const loader = pathToFileURL(join(root, 'rsh/Programs/CLI/src/native-profile-loader.ts')).href
      const script = [
        "const { loadNativeProfile } = await import(" + JSON.stringify(loader) + ")",
        "const loaded = await loadNativeProfile({ profile: 'native-headless', target: 'host',",
        "  patchFiles: [], home: " + JSON.stringify(home) + ", profileDir: " + JSON.stringify(profile) + ",",
        "  installAnchor: " + JSON.stringify(join(profile, 'package.json')) + " })",
        "const request = loaded.requests.get('agent-default-model')",
        "console.log('ROW ' + JSON.stringify({ name: request.plugin.name, provides: request.plugin.provides,",
        "  config: request.config, pkg: request.package.name, scope: String(request.scope !== undefined) }))",
      ].join('\n')
      const child = await execa(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', script],
        { env: { ...process.env, RSH_HOME: home }, reject: false, timeout: 60_000 })
      const line = child.stdout.split('\n').find(entry => entry.startsWith('ROW '))
      expect(child.exitCode, child.stderr).toBe(0)
      expect(line).toBeDefined()
      const parsed = JSON.parse(String(line).slice(4)) as {
        name: string; provides: readonly string[]; config: { provider: string; model: string }; pkg: string
      }
      expect(parsed.pkg).toBe('@redspark/rsh-agent-default-model')
      expect(parsed.name).toBe('@redspark/rsh-agent-default-model')
      expect(parsed.provides).toEqual(['agentDefaultModel'])
      expect(parsed.config).toEqual({ provider: 'deepseek', model: 'deepseek-flash' })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

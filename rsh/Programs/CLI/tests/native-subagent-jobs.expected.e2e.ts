/** Built shipped-profile loading rejects background controls bound to another Jobs registry. */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { shippedNativeProfileComposition } from '../src/native-profile-template.ts'

const root = fileURLToPath(new URL('../../../../', import.meta.url))

it('rejects inherited Subagent background Jobs that differ from scoped controls', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-native-sdk-scoped-jobs-'))
  try {
    const profile = join(home, 'profiles', 'native-sdk')
    mkdirSync(profile, { recursive: true })
    const composition = shippedNativeProfileComposition(home, 'native-sdk')
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'native-sdk-scoped-jobs', private: true,
      dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } }))
    writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ ...composition,
      scopes: [...composition.scopes, { id: 'child', parent: 'root' }],
      installations: [
        ...composition.installations.map(installation => ['tool-jobs', 'subagent-tool'].includes(installation.id)
          ? { ...installation, scope: 'child' } : installation),
        { id: 'child-jobs', plugin: '@deepseek-ai/dsh-native-jobs', scope: 'child' },
      ],
    }))
    const launch = await execa(process.execPath, [join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-sdk'], {
      env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }, reject: false, timeout: 10000,
    })
    expect(launch.exitCode).not.toBe(0)
    expect(launch.stderr).toContain('Provider, jobs and jobControls must select the same Jobs registry')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

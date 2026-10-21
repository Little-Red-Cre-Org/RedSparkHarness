import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cordisConfigFiles, readCordisConfigFile } from './cordis-config-files.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('cordisConfigFiles', () => {
  it('reads only Git-declared symlink placeholders as config links', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-cordis-config-link-'))
    roots.push(root)
    execFileSync('git', ['init', '--quiet', root])
    const pointer = './actual.cordis.yml'
    writeFileSync(join(root, 'actual.cordis.yml'), '[]\n')
    writeFileSync(join(root, 'cordis.yml'), pointer)
    expect(readCordisConfigFile(root, 'cordis.yml')).toBe(pointer)
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: root, input: pointer, encoding: 'utf8' }).trim()
    execFileSync('git', ['update-index', '--add', '--cacheinfo', `120000,${blob},cordis.yml`], { cwd: root })
    expect(readCordisConfigFile(root, 'cordis.yml')).toBe('[]\n')
    writeFileSync(join(root, 'cordis.yml'), '../outside.yml')
    expect(() => readCordisConfigFile(root, 'cordis.yml')).toThrow('escapes repository')
  })
  it('finds Loader YAML without treating translation records as configs', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-cordis-config-files-'))
    roots.push(root)
    for (const directory of ['.claude', 'apps/cli/config/examples', 'docs', 'node_modules/pkg', 'vendor/pkg']) {
      mkdirSync(join(root, directory), { recursive: true })
    }
    for (const file of [
      '.claude/hidden.cordis.yml',
      'docs/cordis-primer.i18n.yaml',
      'apps/cli/config/examples/agent.cordis.yaml',
      'apps/cli/config/examples/headless.cordis.yml',
      'node_modules/pkg/hidden.cordis.yml',
      'vendor/pkg/hidden.cordis.yml',
    ]) {
      writeFileSync(join(root, file), '[]\n')
    }

    expect(cordisConfigFiles(root)).toEqual([
      join('apps', 'cli', 'config', 'examples', 'agent.cordis.yaml'),
      join('apps', 'cli', 'config', 'examples', 'headless.cordis.yml'),
    ])
  })
})

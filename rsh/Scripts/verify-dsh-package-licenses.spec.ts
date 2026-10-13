import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectDshPackageLicenses } from './verify-dsh-package-licenses.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeManifest(root: string, file: string, manifest: Record<string, unknown>): void {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

function writeText(root: string, file: string, contents: string): void {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

function createWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-package-licenses-'))
  roots.push(root)
  writeManifest(root, 'package.json', {
    name: '@deepseek-ai/dsh-root',
    license: 'MIT',
    workspaces: ['rsh/Programs/*', 'rsh/*/*', 'rsh/Core/vendor/*'],
  })
  return root
}

describe('DSH package license gate', () => {
  it('checks unhyphenated CLI and dsh-prefixed package names while ignoring private root and other families', () => {
    const root = createWorkspace()
    writeManifest(root, 'rsh/Programs/CLI/package.json', { name: '@deepseek-ai/dsh', license: 'MIT' })
    writeManifest(root, 'rsh/Engine/core/agent/package.json', {
      name: '@deepseek-ai/dsh-agent',
      license: 'BSD-3-Clause',
    })
    writeManifest(root, 'rsh/Core/vendor/cordis/package.json', {
      name: '@deepseek-ai/cordis',
      license: 'BSD-3-Clause',
    })

    expect(inspectDshPackageLicenses(root)).toEqual({
      packageCount: 2,
      failures: [
        'rsh/Engine/core/agent/package.json: @deepseek-ai/dsh-agent must declare "license": "MIT"; found "BSD-3-Clause".',
      ],
    })
  })

  it('rejects a missing license declaration', () => {
    const root = createWorkspace()
    writeManifest(root, 'rsh/Engine/core/agent/package.json', { name: '@deepseek-ai/dsh-agent' })

    expect(inspectDshPackageLicenses(root).failures).toEqual([
      'rsh/Engine/core/agent/package.json: @deepseek-ai/dsh-agent must declare "license": "MIT"; found undefined.',
    ])
  })

  it('accepts the exact ACP child research-license package and payload', () => {
    const root = createWorkspace()
    const manifestPath = 'rsh/Modules/Official/subagent/acp-child/package.json'
    const licenseText = 'RedSpark research license fixture\n'
    writeText(root, 'LICENSE-REDSPARK-RESEARCH.txt', licenseText)
    writeText(root, 'rsh/Modules/Official/subagent/acp-child/LICENSE-REDSPARK-RESEARCH.txt', licenseText)
    writeManifest(root, manifestPath, {
      name: '@deepseek-ai/dsh-acp-child',
      license: 'SEE LICENSE IN LICENSE-REDSPARK-RESEARCH.txt',
      files: ['LICENSE-REDSPARK-RESEARCH.txt', 'lib/index.js'],
    })

    expect(inspectDshPackageLicenses(root)).toEqual({ packageCount: 1, failures: [] })
  })

  it('rejects the research license for another package identity or repository path', () => {
    const root = createWorkspace()
    const researchLicense = 'SEE LICENSE IN LICENSE-REDSPARK-RESEARCH.txt'
    writeManifest(root, 'rsh/Modules/Official/subagent/acp-child/package.json', {
      name: '@deepseek-ai/dsh-subagent-acp',
      license: researchLicense,
      files: ['LICENSE-REDSPARK-RESEARCH.txt'],
    })
    writeManifest(root, 'rsh/Engine/subagent/acp-child/package.json', {
      name: '@deepseek-ai/dsh-acp-child',
      license: researchLicense,
      files: ['LICENSE-REDSPARK-RESEARCH.txt'],
    })

    expect(inspectDshPackageLicenses(root)).toEqual({
      packageCount: 2,
      failures: [
        'rsh/Engine/subagent/acp-child/package.json: @deepseek-ai/dsh-acp-child must declare "license": "MIT"; '
        + 'found "SEE LICENSE IN LICENSE-REDSPARK-RESEARCH.txt".',
        'rsh/Modules/Official/subagent/acp-child/package.json: expected package name '
        + '@deepseek-ai/dsh-acp-child; found "@deepseek-ai/dsh-subagent-acp".',
      ],
    })
  })

  it('requires the research declaration and packaged license file entry', () => {
    const root = createWorkspace()
    const licenseText = 'RedSpark research license fixture\n'
    writeText(root, 'LICENSE-REDSPARK-RESEARCH.txt', licenseText)
    writeText(root, 'rsh/Modules/Official/subagent/acp-child/LICENSE-REDSPARK-RESEARCH.txt', licenseText)
    writeManifest(root, 'rsh/Modules/Official/subagent/acp-child/package.json', {
      name: '@deepseek-ai/dsh-acp-child',
      license: 'MIT',
      files: 'lib/index.js',
    })

    expect(inspectDshPackageLicenses(root).failures).toEqual([
      'rsh/Modules/Official/subagent/acp-child/package.json: @deepseek-ai/dsh-acp-child must declare '
      + '"license": "SEE LICENSE IN LICENSE-REDSPARK-RESEARCH.txt"; found "MIT".',
      'rsh/Modules/Official/subagent/acp-child/package.json: @deepseek-ai/dsh-acp-child must include '
      + '"LICENSE-REDSPARK-RESEARCH.txt" in "files".',
    ])
  })

  it('rejects a missing or changed package license copy', () => {
    const root = createWorkspace()
    const licenseText = 'RedSpark research license fixture\n'
    const rootLicense = 'LICENSE-REDSPARK-RESEARCH.txt'
    const packageLicense = 'rsh/Modules/Official/subagent/acp-child/LICENSE-REDSPARK-RESEARCH.txt'
    writeManifest(root, 'rsh/Modules/Official/subagent/acp-child/package.json', {
      name: '@deepseek-ai/dsh-acp-child',
      license: 'SEE LICENSE IN LICENSE-REDSPARK-RESEARCH.txt',
      files: ['LICENSE-REDSPARK-RESEARCH.txt'],
    })

    expect(inspectDshPackageLicenses(root).failures).toEqual([
      'rsh/Modules/Official/subagent/acp-child/package.json: missing repository license LICENSE-REDSPARK-RESEARCH.txt.',
      'rsh/Modules/Official/subagent/acp-child/package.json: missing package license LICENSE-REDSPARK-RESEARCH.txt.',
    ])

    writeText(root, rootLicense, licenseText)
    expect(inspectDshPackageLicenses(root).failures).toEqual([
      'rsh/Modules/Official/subagent/acp-child/package.json: missing package license LICENSE-REDSPARK-RESEARCH.txt.',
    ])

    writeText(root, packageLicense, 'different license text\n')
    expect(inspectDshPackageLicenses(root).failures).toEqual([
      'rsh/Modules/Official/subagent/acp-child/package.json: package license LICENSE-REDSPARK-RESEARCH.txt '
      + 'must match repository LICENSE-REDSPARK-RESEARCH.txt.',
    ])
  })
})

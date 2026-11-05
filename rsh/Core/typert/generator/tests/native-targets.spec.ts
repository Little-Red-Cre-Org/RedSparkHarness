import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceTypertGenerator } from '../src/workspace.ts'

const fixtureRoot = resolve(import.meta.dirname, 'fixtures/native-targets')
const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Native entry face selection', { timeout: 60_000 }, () => {
  it('leaves a Client-only native entry out of the Host face', () => {
    const [artifact] = new WorkspaceTypertGenerator(fixtureRoot, { checkDiagnostics: false }).generate()

    expect(artifact).toMatchObject({ package: '@fixture/mixed', face: 'host' })
    expect(artifact?.js).not.toContain('ClientOnlyNativeMarker')
  })

  it('keeps a native entry whose manifest declares no native targets', () => {
    const root = copyFixture()
    writeNativeTargets(root, undefined)
    includeHostProjectFile(root, 'src/native.ts')

    const [artifact] = new WorkspaceTypertGenerator(root, { checkDiagnostics: false }).generate()

    expect(artifact?.js).toContain('ClientOnlyNativeMarker')
  })

  it('collects the native entry when its targets name only host', () => {
    const root = copyFixture()
    writeNativeTargets(root, ['host'])
    includeHostProjectFile(root, 'src/native.ts')

    const [artifact] = new WorkspaceTypertGenerator(root, { checkDiagnostics: false }).generate()

    expect(artifact?.js).toContain('ClientOnlyNativeMarker')
  })

  it('collects the native entry when its targets name both faces', () => {
    const root = copyFixture()
    writeNativeTargets(root, ['client', 'host'])
    includeHostProjectFile(root, 'src/native.ts')

    const [artifact] = new WorkspaceTypertGenerator(root, { checkDiagnostics: false }).generate()

    expect(artifact?.js).toContain('ClientOnlyNativeMarker')
  })
})

interface FixtureManifest {
  exports: Record<string, unknown>
  files: string[]
  dsh: { client?: object; native: { targets?: string[] } }
}

function copyFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-typert-native-targets-'))
  cpSync(fixtureRoot, root, { recursive: true })
  temporaryRoots.push(root)
  return root
}

function writeNativeTargets(root: string, targets: readonly string[] | undefined): void {
  const path = join(root, 'packages/mixed/package.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as FixtureManifest
  if (targets === undefined) delete manifest.dsh.native.targets
  else manifest.dsh.native.targets = [...targets]
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

function includeHostProjectFile(root: string, relativePath: string): void {
  const path = join(root, 'packages/mixed/tsconfig.host.json')
  const config = JSON.parse(readFileSync(path, 'utf8')) as { files: string[] }
  config.files = [...config.files, relativePath].sort((left, right) => left.localeCompare(right))
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`)
}

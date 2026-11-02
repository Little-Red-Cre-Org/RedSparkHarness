/** Release family discovery, publish order, tag naming, and the bump judgements. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { officialClientBuildEnvironment, writeClientBuildRecord } from '../client-build-environment.ts'
import { releaseFamily, type ReleaseMember } from './families.ts'
import { compareVersions, nextVendorVersion, planShared, reachesPayload } from './bump.ts'

/**
 * A release member standing in for a manifest on disk.
 * @param directory - repository-relative package directory.
 * @param name - package name.
 * @param manifest - manifest fields the subject reads.
 * @returns The member.
 */
function member(directory: string, name: string, manifest: Record<string, unknown> = {}): ReleaseMember {
  return { directory, name, version: '0.0.1', manifest }
}

const roots: string[] = []

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function buildFixture(environment: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-release-build-'))
  roots.push(root)
  write(join(root, 'package.json'), `${JSON.stringify({ version: environment.RSH_CLIENT_VERSION ?? '0.0.1' })}\n`)
  write(join(root, 'rsh/Programs/Web/application/dist/index.html'), '<main></main>')
  write(join(root, 'rsh/Programs/Web/client/example/lib/client.js'), 'module.exports = {}\n')
  writeClientBuildRecord(root, environment)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe('release families', () => {
  it('includes the nested Web application in the dsh publish set', () => {
    const members = releaseFamily('dsh').members(resolve(import.meta.dirname, '../../..'))
    expect(members.find(entry => entry.name === '@redspark/rsh-web-frontend')?.directory)
      .toBe('rsh/Programs/Web/application')
    expect(members.find(entry => entry.name === '@redspark/rsh-settings-definition')?.directory)
      .toBe('rsh/Core/settings/settings-definition')
  })

  it('publishes Agent Teams while excluding private experimental packages', () => {
    const members = releaseFamily('dsh').members(resolve(import.meta.dirname, '../../..'))

    expect(members
      .filter(member => member.directory.startsWith('rsh/Modules/Community/experimental/'))
      .map(member => member.name)).toEqual([
      '@redspark/rsh-experimental-agent-team-profile',
      '@redspark/rsh-experimental-agent-team-web-profile',
      '@redspark/rsh-experimental-agent-team',
      '@redspark/rsh-experimental-client-ui-agent-team',
      '@redspark/rsh-experimental-tool-agent-team',
    ])
    expect(members.map(member => member.name)).not.toContain('@redspark/rsh-experimental-inspector')
  })

  it('refuses two directories that publish one package identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-release-duplicate-'))
    roots.push(root)
    for (const directory of ['rsh/Programs/Alpha', 'rsh/Programs/Beta']) {
      write(join(root, directory, 'package.json'), `${JSON.stringify({
        name: '@redspark/rsh-duplicated', version: '1.0.0', description: 'one identity',
      })}\n`)
    }

    expect(() => releaseFamily('dsh').members(root))
      .toThrow('@redspark/rsh-duplicated appears twice in release family dsh')
  })

  it('refuses a version split across one package identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-release-versions-'))
    roots.push(root)
    write(join(root, 'rsh/Programs/Alpha/package.json'), `${JSON.stringify({
      name: '@redspark/rsh-alpha', version: '1.0.0', description: 'alpha',
    })}\n`)
    write(join(root, 'rsh/Programs/Beta/package.json'), `${JSON.stringify({
      name: '@redspark/rsh-beta', version: '2.0.0', description: 'beta',
    })}\n`)

    const family = releaseFamily('dsh')
    expect(() => { family.verifyVersions(family.members(root)) })
      .toThrow(/must share one version/u)
  })

  it('excludes private applications from the publish set', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-release-private-'))
    roots.push(root)
    write(join(root, 'rsh/Programs/public/package.json'), '{"name":"@redspark/rsh-public","version":"0.0.1"}\n')
    write(join(root, 'rsh/Programs/private/package.json'), '{"name":"@redspark/rsh-private","version":"0.0.1","private":true}\n')

    expect(releaseFamily('dsh').members(root).map(entry => entry.name)).toEqual(['@redspark/rsh-public'])
  })

  it('bumps private dsh workspaces without adding release tags', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-release-version-'))
    roots.push(root)
    write(join(root, 'package.json'), '{"version":"0.0.1"}\n')
    write(join(root, 'rsh/Programs/Desktop/package.json'), '{"version":"0.0.1","private":true}\n')
    write(join(root, 'rsh/Modules/Community/experimental/prototype/package.json'), '{"version":"0.0.1","private":true}\n')
    write(join(root, 'rsh/Engine/core/unselected/package.json'), '{"version":"0.0.1"}\n')
    for (const path of [
      'rsh/Core/typert/generator/tests/fixtures/remote-model/package.json',
      'rsh/Core/vendor/cordis/package.json',
      'rsh/Core/native/system/package.json',
      'rsh/Programs/Desktop/.desktop-build/runtime/package.json',
    ]) {
      write(join(root, path), '{"private":true}\n')
    }

    const dsh = releaseFamily('dsh')
    const published = member('rsh/Engine/core/published', '@redspark/rsh-published')
    const { planned } = planShared(dsh, root, [published], '0.0.2')

    expect(planned.map(entry => ({ path: entry.manifestPath, tag: entry.tag }))).toEqual([
      { path: 'package.json', tag: undefined },
      { path: 'rsh/Engine/core/published/package.json', tag: 'dsh-v0.0.2' },
      { path: 'rsh/Modules/Community/experimental/prototype/package.json', tag: undefined },
      { path: 'rsh/Programs/Desktop/package.json', tag: undefined },
    ])
  })

  it.each(['0.0.2-alpha.1', '0.0.2-canary.1', '0.0.2-rc.1'])(
    'accepts the explicit dsh prerelease version %s',
    (version) => {
      const root = mkdtempSync(join(tmpdir(), 'dsh-release-prerelease-'))
      roots.push(root)
      write(join(root, 'package.json'), '{"version":"0.0.1"}\n')

      const dsh = releaseFamily('dsh')
      const published = member('rsh/Engine/core/published', '@redspark/rsh-published')
      const plan = planShared(dsh, root, [published], version)

      expect(plan.version).toBe(version)
      expect(plan.planned[1]?.tag).toBe(`dsh-v${version}`)
    },
  )

  it('names one tag for the whole dsh family and one per vendored package', () => {
    const dsh = releaseFamily('dsh')
    const vendor = releaseFamily('vendor')
    const cli = member('rsh/Programs/CLI', '@redspark/dsh')
    const cordis = { ...member('rsh/Core/vendor/cordis', '@redspark/cordis'), version: '4.0.1' }

    expect(dsh.tagFor(cli)).toBe('dsh-v0.0.1')
    expect(vendor.tagFor(cordis)).toBe('vendor-cordis-v4.0.1')
    // The prefix is constructed, not recovered from a tag: a version with a
    // hyphen would defeat any suffix-stripping.
    expect(vendor.tagPrefixFor({ ...cordis, version: '4.0.0-rc.7' })).toBe('vendor-cordis-v')
    expect(vendor.tagFor({ ...cordis, version: '4.0.0-rc.7' })).toBe('vendor-cordis-v4.0.0-rc.7')
  })

  it('assigns alpha and canary dist-tags only to dsh releases', () => {
    const dsh = releaseFamily('dsh')
    const vendor = releaseFamily('vendor')

    expect(dsh.distTagForVersion('0.0.2-alpha.1')).toBe('alpha')
    expect(dsh.distTagForVersion('0.0.2-canary.1')).toBe('canary')
    expect(dsh.distTagForVersion('0.0.2-rc.1')).toBe('next')
    expect(dsh.distTagForVersion('0.0.2')).toBeUndefined()
    expect(vendor.distTagForVersion('4.0.1-alpha.1')).toBe('next')
    expect(vendor.distTagForVersion('4.0.1-canary.1')).toBe('next')
  })

  it('rejects a family whose members disagree on the shared version', () => {
    const dsh = releaseFamily('dsh')
    const members = [member('rsh/Programs/CLI', '@redspark/dsh'), { ...member('rsh/Programs/Web/application', '@redspark/rsh-web-frontend'), version: '0.0.2' }]

    expect(() => { dsh.verifyVersions(members) }).toThrow(/must share one version/)
    expect(() => { dsh.verifyVersions([members[0]!]) }).not.toThrow()
  })

  it('accepts independent vendored versions and rejects an unpublishable one', () => {
    const vendor = releaseFamily('vendor')
    const members = [
      { ...member('rsh/Core/vendor/cordis', '@redspark/cordis'), version: '4.0.1' },
      { ...member('rsh/Core/vendor/cosmokit', '@redspark/cosmokit'), version: '1.8.2' },
    ]

    expect(() => { vendor.verifyVersions(members) }).not.toThrow()
    expect(() => { vendor.verifyVersions([{ ...members[0]!, version: 'latest' }]) }).toThrow(/unpublishable version/)
  })

  it('requires a current official client build only for dsh artifacts', () => {
    const dsh = releaseFamily('dsh')
    const vendor = releaseFamily('vendor')
    const officialEnvironment = officialClientBuildEnvironment(resolve(import.meta.dirname, '../../..'))
    vi.stubEnv('RSH_CLIENT_COMMIT_HASH', officialEnvironment.RSH_CLIENT_COMMIT_HASH)
    const official = buildFixture(officialEnvironment)
    const defaultBuild = buildFixture({})
    const missing = join(defaultBuild, 'missing')
    write(join(missing, 'package.json'), `${JSON.stringify({ version: officialEnvironment.RSH_CLIENT_VERSION })}\n`)

    expect(() => { dsh.verifyBuildArtifacts(official) }).not.toThrow()
    expect(() => { dsh.verifyBuildArtifacts(defaultBuild) }).toThrow(/RSH_CLIENT_TITLE/)
    expect(() => { dsh.verifyBuildArtifacts(missing) }).toThrow(/record.*missing/)
    expect(() => { vendor.verifyBuildArtifacts(missing) }).not.toThrow()

    write(join(official, 'rsh/Programs/Web/client/example/lib/client.js'), 'module.exports = { changed: true }\n')
    expect(() => { dsh.verifyBuildArtifacts(official) }).toThrow(/artifacts differ/)
  })

  it('publishes a dependency before its consumer, and orders ties by name', () => {
    const dsh = releaseFamily('dsh')
    const members = [
      member('rsh/a/consumer', '@redspark/rsh-consumer', { dependencies: { '@redspark/rsh-library': 'workspace:^' } }),
      member('rsh/a/library', '@redspark/rsh-library'),
      member('rsh/a/zebra', '@redspark/rsh-zebra'),
    ]

    expect(dsh.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@redspark/rsh-library',
      '@redspark/rsh-consumer',
      '@redspark/rsh-zebra',
    ])
  })

  it('reports a runtime dependency cycle instead of emitting an arbitrary order', () => {
    const dsh = releaseFamily('dsh')
    const members = [
      member('rsh/a/left', '@redspark/rsh-left', { dependencies: { '@redspark/rsh-right': 'workspace:^' } }),
      member('rsh/a/right', '@redspark/rsh-right', { dependencies: { '@redspark/rsh-left': 'workspace:^' } }),
    ]

    expect(() => { dsh.publishOrder(members) }).toThrow(/dependency cycle/)
  })

  it('publishes a peer before its consumer', () => {
    const dsh = releaseFamily('dsh')
    const members = [
      member('rsh/a/consumer', '@redspark/rsh-consumer', { peerDependencies: { '@redspark/rsh-zebra': 'workspace:^' } }),
      member('rsh/a/zebra', '@redspark/rsh-zebra'),
    ]

    // Name order alone would place the consumer first; the peer edge moves it.
    expect(dsh.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@redspark/rsh-zebra',
      '@redspark/rsh-consumer',
    ])
  })

  it('orders around a peer cycle rather than refusing to publish, and reports the edge it dropped', () => {
    const dsh = releaseFamily('dsh')
    const members = [
      member('rsh/a/left', '@redspark/rsh-left', { peerDependencies: { '@redspark/rsh-right': 'workspace:^' } }),
      member('rsh/a/right', '@redspark/rsh-right', { peerDependencies: { '@redspark/rsh-left': 'workspace:^' } }),
    ]

    // Sibling peer ordering may cycle, so one ordering preference is omitted
    // while both manifest declarations remain intact.
    const plan = dsh.publishOrder(members)
    expect(plan.order.map(entry => entry.name)).toEqual([
      '@redspark/rsh-right',
      '@redspark/rsh-left',
    ])
    // One of the two edges has to give, and which one it is belongs in the log.
    expect(plan.droppedPeerEdges).toEqual([
      { consumer: '@redspark/rsh-right', peer: '@redspark/rsh-left' },
    ])
  })

  it('honours an install edge even when a peer cycle surrounds it', () => {
    const dsh = releaseFamily('dsh')
    const members = [
      member('rsh/a/base', '@redspark/rsh-base', { peerDependencies: { '@redspark/rsh-consumer': 'workspace:^' } }),
      member('rsh/a/consumer', '@redspark/rsh-consumer', {
        dependencies: { '@redspark/rsh-base': 'workspace:^' },
        peerDependencies: { '@redspark/rsh-base': 'workspace:^' },
      }),
    ]

    // The install edge is absolute: base publishes first, and the reverse peer
    // preference is the one omitted. The matching peer edge is already satisfied.
    const plan = dsh.publishOrder(members)
    expect(plan.order.map(entry => entry.name)).toEqual([
      '@redspark/rsh-base',
      '@redspark/rsh-consumer',
    ])
    expect(plan.droppedPeerEdges).toEqual([
      { consumer: '@redspark/rsh-base', peer: '@redspark/rsh-consumer' },
    ])
  })

  it('drops the peer preference that closes a cycle around an install edge', () => {
    const dsh = releaseFamily('dsh')
    const members = [
      member('rsh/a/alpha', '@redspark/rsh-alpha', { peerDependencies: { '@redspark/rsh-bravo': 'workspace:^' } }),
      member('rsh/a/bravo', '@redspark/rsh-bravo', { peerDependencies: { '@redspark/rsh-charlie': 'workspace:^' } }),
      member('rsh/a/charlie', '@redspark/rsh-charlie', { dependencies: { '@redspark/rsh-alpha': 'workspace:^' } }),
    ]

    const plan = dsh.publishOrder(members)
    expect(plan.order.map(entry => entry.name)).toEqual([
      '@redspark/rsh-bravo',
      '@redspark/rsh-alpha',
      '@redspark/rsh-charlie',
    ])
    expect(plan.droppedPeerEdges).toEqual([
      { consumer: '@redspark/rsh-bravo', peer: '@redspark/rsh-charlie' },
    ])
  })

  it('ignores devDependencies when ordering', () => {
    const dsh = releaseFamily('dsh')
    const members = [
      member('rsh/a/alpha', '@redspark/rsh-alpha', { devDependencies: { '@redspark/rsh-zebra': 'workspace:^' } }),
      member('rsh/a/zebra', '@redspark/rsh-zebra'),
    ]

    // A dev dependency is absent from the published package, so it must not move
    // the consumer behind it.
    expect(dsh.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@redspark/rsh-alpha',
      '@redspark/rsh-zebra',
    ])
  })

  it('applies the harness payload policy to dsh and keeps upstream payloads for vendored packages', () => {
    const dsh = releaseFamily('dsh')
    const vendor = releaseFamily('vendor')
    const harness = member('rsh/a/library', '@redspark/rsh-library')
    const vendored = member('rsh/Core/vendor/cordis', '@redspark/cordis')

    expect(() => { dsh.validatePayload(harness, ['package/lib/index.js', 'package/src/index.ts']) })
      .toThrow(/publishes source file/)
    expect(() => { vendor.validatePayload(vendored, ['package/lib/index.js', 'package/src/index.ts']) }).not.toThrow()
    expect(() => { vendor.validatePayload(vendored, []) }).toThrow(/empty tarball/)
  })

  it('drives the installed entry only for the family that publishes one', () => {
    expect(releaseFamily('dsh').installedEntry).toEqual({ packageName: '@redspark/dsh', binPath: 'lib/bin.js' })
    expect(releaseFamily('vendor').installedEntry).toBeUndefined()
  })

  it('rejects an unknown family identifier', () => {
    expect(() => { releaseFamily('native') }).toThrow(/unknown release family/)
  })
})

describe('vendored version baseline', () => {
  it('drops an upstream prerelease segment and increments the patch', () => {
    expect(nextVendorVersion('4.0.0-rc.7', undefined)).toBe('4.0.1')
    expect(nextVendorVersion('1.0.0-rc.5', undefined)).toBe('1.0.1')
    expect(nextVendorVersion('1.8.1', undefined)).toBe('1.8.2')
  })

  it('increments from the last published version when a re-sync restored a lower one', () => {
    // Upstream moved rc.7 -> rc.8 after this repository published 4.0.1;
    // incrementing the manifest alone would name 4.0.1 a second time.
    expect(nextVendorVersion('4.0.0-rc.8', '4.0.1')).toBe('4.0.2')
    expect(nextVendorVersion('4.1.0', '4.0.1')).toBe('4.1.1')
  })

  it('appends a rehearsal prerelease without consuming its release numbers', () => {
    // A rehearsal burns 4.0.1-rc.1 and leaves 4.0.1 free, so the stable release
    // that follows takes those same numbers instead of skipping to 4.0.2.
    expect(nextVendorVersion('4.0.0-rc.7', undefined, 'rc.1')).toBe('4.0.1-rc.1')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1-rc.1', 'rc.2')).toBe('4.0.1-rc.2')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1-rc.1')).toBe('4.0.1')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1')).toBe('4.0.2')
  })
})

describe('version precedence', () => {
  it('orders alpha, canary, and release-candidate versions by semver precedence', () => {
    expect(compareVersions('4.0.1-alpha.1', '4.0.1-canary.1')).toBeLessThan(0)
    expect(compareVersions('4.0.1-canary.1', '4.0.1-rc.1')).toBeLessThan(0)
    expect(compareVersions('4.0.1-rc.1', '4.0.1')).toBeLessThan(0)
  })

  it('ranks a release above the prerelease it follows', () => {
    // git --sort=v:refname disagrees, placing 4.0.1-rc.1 above 4.0.1, which is
    // why the newest published version is chosen here rather than by git.
    expect(compareVersions('4.0.1', '4.0.1-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.1', '4.0.1')).toBeLessThan(0)
  })

  it('compares numeric prerelease fields numerically', () => {
    expect(compareVersions('4.0.1-rc.10', '4.0.1-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.2', '4.0.1-rc.10')).toBeLessThan(0)
  })

  it('ranks a numeric field below an alphanumeric one, and a shorter list below a longer', () => {
    expect(compareVersions('4.0.1-1', '4.0.1-alpha')).toBeLessThan(0)
    expect(compareVersions('4.0.1-rc', '4.0.1-rc.1')).toBeLessThan(0)
    expect(compareVersions('4.0.2', '4.0.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.1', '4.0.1-rc.1')).toBe(0)
  })
})

describe('payload change judgement', () => {
  const sourceShipping = member('rsh/Core/vendor/cosmokit', '@redspark/cosmokit', {
    files: ['lib/index.js', 'lib/types/**/*.d.ts', 'src'],
  })
  const buildOutputOnly = member('rsh/Core/vendor/cordis', '@redspark/cordis', {
    files: ['lib/index.js', 'lib/types/**/*.d.ts', 'bin.js'],
  })

  it('counts the manifest and the files npm always publishes', () => {
    expect(reachesPayload(sourceShipping, 'rsh/Core/vendor/cosmokit/package.json')).toBe(true)
    expect(reachesPayload(sourceShipping, 'rsh/Core/vendor/cosmokit/README.md')).toBe(true)
    expect(reachesPayload(sourceShipping, 'rsh/Core/vendor/cosmokit/src/index.ts')).toBe(true)
  })

  it('counts build inputs for a package whose payload is build output', () => {
    // cordis publishes lib/ only, and lib/ is not tracked: without this, a real
    // source change reads as "nothing changed" and the next publish fails on a
    // version whose bytes moved.
    expect(reachesPayload(buildOutputOnly, 'rsh/Core/vendor/cordis/src/context.ts')).toBe(true)
    expect(reachesPayload(buildOutputOnly, 'rsh/Core/vendor/cordis/tsconfig.json')).toBe(true)
  })

  it('ignores paths no tarball carries', () => {
    expect(reachesPayload(sourceShipping, 'rsh/Core/vendor/cosmokit/tests/unit.spec.ts')).toBe(false)
    expect(reachesPayload(sourceShipping, 'rsh/Core/vendor/cosmokit/CHANGELOG.md')).toBe(false)
    // The README pattern is deliberately loose: over-reporting a change costs one
    // unnecessary patch bump, while under-reporting fails the next publish on a
    // version whose bytes moved.
    expect(reachesPayload(sourceShipping, 'rsh/Core/vendor/cosmokit/README.i18n.yaml')).toBe(true)
    expect(reachesPayload(member('rsh/a/library', '@redspark/rsh-library', { files: ['lib/index.js'] }),
      'rsh/a/library/tests/library.spec.ts')).toBe(false)
  })
})

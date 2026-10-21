import { describe, expect, it } from 'vitest'
import type { NpmPackageLock, RegistryIndex } from './benchmark-npm-resolution.ts'
import {
  assertDualDshInstallLayout,
  buildDualDshRegistry,
} from './verify-npm-install-layout.ts'

function validLayout(): NpmPackageLock {
  return {
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { '@deepseek-ai/dsh': '0.2.0', 'dsh-previous': 'npm:@deepseek-ai/dsh@0.1.0' } },
      'node_modules/@deepseek-ai/cordis': { version: '4.0.1' },
      'node_modules/react': { version: '18.3.1' },
      'node_modules/react-dom': { version: '18.3.1', peerDependencies: { react: '^18.2.0' } },
      'node_modules/@deepseek-ai/dsh': {
        version: '0.2.0',
        dependencies: {
          '@deepseek-ai/dsh-child': '^0.2.0',
          '@deepseek-ai/dsh-sdk-client': '^0.2.0',
          react: '^18.2.0',
          'react-dom': '^18.2.0',
        },
        peerDependencies: { '@deepseek-ai/cordis': '^4.0.1' },
      },
      'node_modules/@deepseek-ai/dsh-child': {
        version: '0.2.0',
        dependencies: { '@deepseek-ai/dsh-leaf': '^0.2.0' },
      },
      'node_modules/@deepseek-ai/dsh-leaf': { version: '0.2.0' },
      'node_modules/@deepseek-ai/dsh-sdk-client': {
        version: '0.2.0',
        dependencies: { '@deepseek-ai/dsh': '0.2.0' },
      },
      'node_modules/dsh-previous': {
        name: '@deepseek-ai/dsh',
        version: '0.1.0',
        dependencies: {
          '@deepseek-ai/dsh-child': '^0.1.0',
          '@deepseek-ai/dsh-sdk-client': '^0.1.0',
          react: '^18.2.0',
          'react-dom': '^18.2.0',
        },
        peerDependencies: { '@deepseek-ai/cordis': '^4.0.1' },
      },
      'node_modules/dsh-previous/node_modules/@deepseek-ai/dsh': {
        name: '@deepseek-ai/dsh',
        version: '0.1.0',
        dependencies: {
          '@deepseek-ai/dsh-child': '^0.1.0',
          '@deepseek-ai/dsh-sdk-client': '^0.1.0',
          react: '^18.2.0',
          'react-dom': '^18.2.0',
        },
        peerDependencies: { '@deepseek-ai/cordis': '^4.0.1' },
      },
      'node_modules/dsh-previous/node_modules/@deepseek-ai/dsh-sdk-client': {
        version: '0.1.0',
        dependencies: { '@deepseek-ai/dsh': '0.1.0' },
      },
      'node_modules/dsh-previous/node_modules/@deepseek-ai/dsh-child': {
        version: '0.1.0',
        dependencies: { '@deepseek-ai/dsh-leaf': '^0.1.0' },
      },
      'node_modules/dsh-previous/node_modules/@deepseek-ai/dsh-leaf': { version: '0.1.0' },
    },
  }
}

describe('npm install layout verifier', () => {
  it('preserves an exact SDK pin and accepts its isolated two-release layout', () => {
    const index: RegistryIndex = new Map([
      ['@deepseek-ai/dsh', new Map([['0.1.1-rc.2', {
        name: '@deepseek-ai/dsh',
        version: '0.1.1-rc.2',
        dependencies: {
          '@deepseek-ai/dsh-child': '^0.1.1-rc.2',
          '@deepseek-ai/dsh-sdk-client': '^0.1.1-rc.2',
        },
        peerDependencies: { '@deepseek-ai/cordis': '^4.0.1' },
      }]])],
      ['@deepseek-ai/dsh-sdk-client', new Map([['0.1.1-rc.2', {
        name: '@deepseek-ai/dsh-sdk-client',
        version: '0.1.1-rc.2',
        dependencies: { '@deepseek-ai/dsh': '0.1.1-rc.2' },
      }]])],
      ['@deepseek-ai/dsh-child', new Map([['0.1.1-rc.2', {
        name: '@deepseek-ai/dsh-child',
        version: '0.1.1-rc.2',
      }]])],
      ['@deepseek-ai/dsh-sdk-client', new Map([['0.1.1-rc.2', {
        name: '@deepseek-ai/dsh-sdk-client',
        version: '0.1.1-rc.2',
        dependencies: { '@deepseek-ai/dsh': '0.1.1-rc.2' },
      }]])],
      ['@deepseek-ai/cordis', new Map([['4.0.1', {
        name: '@deepseek-ai/cordis',
        version: '4.0.1',
      }]])],
    ])

    const dual = buildDualDshRegistry(index, '0.1.1-rc.2')

    expect([...dual.get('@deepseek-ai/dsh')?.keys() ?? []]).toEqual(['0.1.0', '0.2.0'])
    expect(dual.get('@deepseek-ai/dsh')?.get('0.1.0')?.dependencies).toEqual({
      '@deepseek-ai/dsh-child': '^0.1.0',
      '@deepseek-ai/dsh-sdk-client': '^0.1.0',
    })
    expect(dual.get('@deepseek-ai/dsh-sdk-client')?.get('0.1.0')?.dependencies).toEqual({
      '@deepseek-ai/dsh': '0.1.0',
    })
    expect(dual.get('@deepseek-ai/cordis')).toBe(index.get('@deepseek-ai/cordis'))
    expect(assertDualDshInstallLayout(validLayout())).toEqual({
      dshPackagesPerVersion: 4,
      checkedDshEdges: 10,
    })
  })

  it('rejects duplicate React copies and versions outside the CLI declarations', () => {
    const layout = validLayout()
    const packages = {
      ...layout.packages,
      'node_modules/react': { version: '17.0.0' },
      'node_modules/react-dom': { version: '17.0.0', peerDependencies: { react: '^18.2.0' } },
      'node_modules/dsh-previous/node_modules/react': { version: '18.3.1' },
      'node_modules/dsh-previous/node_modules/react-dom': { version: '18.3.1' },
    }

    expect(() => assertDualDshInstallLayout({ ...layout, packages })).toThrow(
      /expected one shared react[\s\S]*expected one shared react-dom[\s\S]*range \^18\.2\.0 does not include 17\.0\.0/,
    )
  })

  it('rejects an internal edge that crosses release versions', () => {
    const layout = validLayout()
    const packages = { ...layout.packages }
    Reflect.deleteProperty(packages, 'node_modules/dsh-previous/node_modules/@deepseek-ai/dsh-leaf')

    expect(() => assertDualDshInstallLayout({ ...layout, packages })).toThrow(
      'node_modules/dsh-previous/node_modules/@deepseek-ai/dsh-child: dependencies '
      + '@deepseek-ai/dsh-leaf resolves to node_modules/@deepseek-ai/dsh-leaf@0.2.0, expected 0.1.0',
    )
  })

  it('rejects a second Cordis installation', () => {
    const layout = validLayout()
    const packages = {
      ...layout.packages,
      'node_modules/dsh-previous/node_modules/@deepseek-ai/cordis': { version: '4.0.1' },
    }

    expect(() => assertDualDshInstallLayout({ ...layout, packages })).toThrow(
      'expected one shared @deepseek-ai/cordis',
    )
  })
})

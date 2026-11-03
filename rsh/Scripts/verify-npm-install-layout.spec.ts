import { describe, expect, it } from 'vitest'
import type { NpmPackageLock, RegistryIndex } from './benchmark-npm-resolution.ts'
import {
  assertDualRshInstallLayout,
  buildDualRshRegistry,
} from './verify-npm-install-layout.ts'

function validLayout(): NpmPackageLock {
  return {
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { '@redspark/rsh': '0.2.0', 'dsh-previous': 'npm:@redspark/rsh@0.1.0' } },
      'node_modules/@redspark/cordis': { version: '4.0.1' },
      'node_modules/react': { version: '18.3.1' },
      'node_modules/react-dom': { version: '18.3.1', peerDependencies: { react: '^18.2.0' } },
      'node_modules/@redspark/rsh': {
        version: '0.2.0',
        dependencies: {
          '@redspark/rsh-child': '^0.2.0',
          '@redspark/rsh-sdk-client': '^0.2.0',
          react: '^18.2.0',
          'react-dom': '^18.2.0',
        },
        peerDependencies: { '@redspark/cordis': '^4.0.1' },
      },
      'node_modules/@redspark/rsh-child': {
        version: '0.2.0',
        dependencies: { '@redspark/rsh-leaf': '^0.2.0' },
      },
      'node_modules/@redspark/rsh-leaf': { version: '0.2.0' },
      'node_modules/@redspark/rsh-sdk-client': {
        version: '0.2.0',
        dependencies: { '@redspark/rsh': '0.2.0' },
      },
      'node_modules/dsh-previous': {
        name: '@redspark/rsh',
        version: '0.1.0',
        dependencies: {
          '@redspark/rsh-child': '^0.1.0',
          '@redspark/rsh-sdk-client': '^0.1.0',
          react: '^18.2.0',
          'react-dom': '^18.2.0',
        },
        peerDependencies: { '@redspark/cordis': '^4.0.1' },
      },
      'node_modules/dsh-previous/node_modules/@redspark/rsh': {
        name: '@redspark/rsh',
        version: '0.1.0',
        dependencies: {
          '@redspark/rsh-child': '^0.1.0',
          '@redspark/rsh-sdk-client': '^0.1.0',
          react: '^18.2.0',
          'react-dom': '^18.2.0',
        },
        peerDependencies: { '@redspark/cordis': '^4.0.1' },
      },
      'node_modules/dsh-previous/node_modules/@redspark/rsh-sdk-client': {
        version: '0.1.0',
        dependencies: { '@redspark/rsh': '0.1.0' },
      },
      'node_modules/dsh-previous/node_modules/@redspark/rsh-child': {
        version: '0.1.0',
        dependencies: { '@redspark/rsh-leaf': '^0.1.0' },
      },
      'node_modules/dsh-previous/node_modules/@redspark/rsh-leaf': { version: '0.1.0' },
    },
  }
}

describe('npm install layout verifier', () => {
  it('preserves an exact SDK pin and accepts its isolated two-release layout', () => {
    const index: RegistryIndex = new Map([
      ['@redspark/rsh', new Map([['0.1.1-rc.2', {
        name: '@redspark/rsh',
        version: '0.1.1-rc.2',
        dependencies: {
          '@redspark/rsh-child': '^0.1.1-rc.2',
          '@redspark/rsh-sdk-client': '^0.1.1-rc.2',
        },
        peerDependencies: { '@redspark/cordis': '^4.0.1' },
      }]])],
      ['@redspark/rsh-sdk-client', new Map([['0.1.1-rc.2', {
        name: '@redspark/rsh-sdk-client',
        version: '0.1.1-rc.2',
        dependencies: { '@redspark/rsh': '0.1.1-rc.2' },
      }]])],
      ['@redspark/rsh-child', new Map([['0.1.1-rc.2', {
        name: '@redspark/rsh-child',
        version: '0.1.1-rc.2',
      }]])],
      ['@redspark/rsh-sdk-client', new Map([['0.1.1-rc.2', {
        name: '@redspark/rsh-sdk-client',
        version: '0.1.1-rc.2',
        dependencies: { '@redspark/rsh': '0.1.1-rc.2' },
      }]])],
      ['@redspark/cordis', new Map([['4.0.1', {
        name: '@redspark/cordis',
        version: '4.0.1',
      }]])],
    ])

    const dual = buildDualRshRegistry(index, '0.1.1-rc.2')

    expect([...dual.get('@redspark/rsh')?.keys() ?? []]).toEqual(['0.1.0', '0.2.0'])
    expect(dual.get('@redspark/rsh')?.get('0.1.0')?.dependencies).toEqual({
      '@redspark/rsh-child': '^0.1.0',
      '@redspark/rsh-sdk-client': '^0.1.0',
    })
    expect(dual.get('@redspark/rsh-sdk-client')?.get('0.1.0')?.dependencies).toEqual({
      '@redspark/rsh': '0.1.0',
    })
    expect(dual.get('@redspark/cordis')).toBe(index.get('@redspark/cordis'))
    expect(assertDualRshInstallLayout(validLayout())).toEqual({
      dshPackagesPerVersion: 4,
      checkedRshEdges: 10,
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

    expect(() => assertDualRshInstallLayout({ ...layout, packages })).toThrow(
      /expected one shared react[\s\S]*expected one shared react-dom[\s\S]*range \^18\.2\.0 does not include 17\.0\.0/,
    )
  })

  it('rejects an internal edge that crosses release versions', () => {
    const layout = validLayout()
    const packages = { ...layout.packages }
    Reflect.deleteProperty(packages, 'node_modules/dsh-previous/node_modules/@redspark/rsh-leaf')

    expect(() => assertDualRshInstallLayout({ ...layout, packages })).toThrow(
      'node_modules/dsh-previous/node_modules/@redspark/rsh-child: dependencies '
      + '@redspark/rsh-leaf resolves to node_modules/@redspark/rsh-leaf@0.2.0, expected 0.1.0',
    )
  })

  it('rejects a second Cordis installation', () => {
    const layout = validLayout()
    const packages = {
      ...layout.packages,
      'node_modules/dsh-previous/node_modules/@redspark/cordis': { version: '4.0.1' },
    }

    expect(() => assertDualRshInstallLayout({ ...layout, packages })).toThrow(
      'expected one shared @redspark/cordis',
    )
  })
})

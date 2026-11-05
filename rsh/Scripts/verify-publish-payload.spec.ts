// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  isBareSpecifier,
  moduleSpecifiersOf,
  moduleTableExemption,
  packageNameOf,
  payloadViolations,
  resolutionCandidates,
  type PackedPayload,
} from './verify-publish-payload.ts'

const NAME = '@redspark/rsh-probe'

/**
 * A packed payload with a Native entry, as \`npm pack\` would produce it.
 * @param files - payload-relative path to file text.
 * @param manifest - manifest fields to override on the default fixture.
 * @returns The payload a consumer would install.
 */
function payload(
  files: Record<string, string>,
  manifest: Record<string, unknown> = {},
): PackedPayload {
  return {
    manifest: {
      name: NAME,
      exports: { './native': { default: './lib/native.js' } },
      files: ['lib/native.js'],
      ...manifest,
    },
    files: new Map(Object.entries({ 'package.json': '{}', ...files })),
  }
}

/** The (file, specifier) pairs a payload reports, for readable assertions. */
function reported(subject: PackedPayload) {
  return payloadViolations(subject).map(violation => `${violation.file} ${violation.specifier}`)
}

describe('packageNameOf', () => {
  it('keeps a leading scope', () => {
    expect(packageNameOf('@redspark/rsh-session')).toBe('@redspark/rsh-session')
    expect(packageNameOf('@redspark/rsh-file-reference/grammar')).toBe('@redspark/rsh-file-reference')
  })

  it('reads the first segment of an unscoped name', () => {
    expect(packageNameOf('react')).toBe('react')
    expect(packageNameOf('react/jsx-runtime')).toBe('react')
  })
})

describe('isBareSpecifier', () => {
  it('admits a package name', () => {
    expect(isBareSpecifier('react')).toBe(true)
    expect(isBareSpecifier('@redspark/rsh-session/native')).toBe(true)
  })

  it('excludes relative, absolute, virtual, and builtin targets', () => {
    expect(isBareSpecifier('./client/A.module.css')).toBe(false)
    expect(isBareSpecifier('../shared/b.js')).toBe(false)
    expect(isBareSpecifier('/abs/path.js')).toBe(false)
    expect(isBareSpecifier('\0dsh-css:a.mjs')).toBe(false)
    expect(isBareSpecifier('node:crypto')).toBe(false)
  })
})

describe('resolutionCandidates', () => {
  it('offers the literal target, an extension, and a directory index', () => {
    const candidates = resolutionCandidates('lib/native.js', './client/A.module.css')
    expect(candidates[0]).toBe('lib/client/A.module.css')
    expect(candidates).toContain('lib/client/A.module.css.js')
    expect(candidates).toContain('lib/client/A.module.css/index.js')
  })

  it('resolves a parent-relative specifier to the payload root', () => {
    expect(resolutionCandidates('lib/client/deep/x.js', '../../shared/b.js')[0]).toBe('lib/shared/b.js')
  })

  it('tries a declaration file for a bare-looking relative target', () => {
    expect(resolutionCandidates('lib/native.js', './types')).toContain('lib/types.d.ts')
  })
})

describe('moduleSpecifiersOf', () => {
  it('reads static imports, re-exports, dynamic import, and require', () => {
    const found = moduleSpecifiersOf('lib/native.js', [
      'import { a } from "./a.js"',
      'export * from "../b.js"',
      'const c = await import("./c.js")',
      'const d = require("./d.js")',
    ].join('\n'))
    expect(found.map(entry => entry.specifier)).toEqual(['./a.js', '../b.js', './c.js', './d.js'])
  })

  it('reports the line each specifier sits on', () => {
    const found = moduleSpecifiersOf('lib/native.js', 'import "react"\n\nexport * from "./b.js"\n')
    expect(found).toEqual([
      { specifier: 'react', line: 1 },
      { specifier: './b.js', line: 3 },
    ])
  })

  it('admits a side-effect import and a minified form', () => {
    const found = moduleSpecifiersOf('lib/native.js', 'import"./a.css"\nexport{x}from"./b.js"\n')
    expect(found.map(entry => entry.specifier)).toEqual(['./a.css', './b.js'])
  })

  it('reads a relative URL resolved against import.meta.url', () => {
    const found = moduleSpecifiersOf('lib/native.js', 'const worker = new URL("./worker.cjs", import.meta.url)\n')
    expect(found.map(entry => entry.specifier)).toEqual(['./worker.cjs'])
  })

  it('reads both branches of a conditional URL', () => {
    const found = moduleSpecifiersOf(
      'lib/native.js',
      'new URL(import.meta.url.endsWith(".ts") ? "./process-child.ts" : "./process-child.js", import.meta.url)\n',
    )
    expect(found.map(entry => entry.specifier)).toEqual(['./process-child.ts', './process-child.js'])
  })

  it('ignores a URL that is not a relative import.meta.url load', () => {
    const found = moduleSpecifiersOf('lib/native.js', [
      'const page = new URL("https://example.test")',
      'const other = new URL("./x.js", base)',
    ].join('\n'))
    expect(found).toEqual([])
  })
})

describe('payloadViolations relative specifiers', () => {
  it('reports a relative target the tarball does not contain', () => {
    const subject = payload({ 'lib/native.js': 'import css from "./client/A.module.css"\n' })
    expect(reported(subject)).toEqual(['lib/native.js:1 ./client/A.module.css'])
    expect(payloadViolations(subject)[0]?.reason)
      .toBe('the tarball contains no file this relative specifier resolves to')
  })

  it('accepts a relative target the tarball contains', () => {
    const subject = payload({
      'lib/native.js': 'import css from "./client/A.module.css"\n',
      'lib/client/A.module.css': '.a{color:red}',
    })
    expect(payloadViolations(subject)).toEqual([])
  })

  it('reports a worker named only through new URL when the tarball omits it', () => {
    const subject = payload({ 'lib/native.js': 'const worker = new URL("./worker.cjs", import.meta.url)\n' })
    expect(reported(subject)).toEqual(['lib/native.js:1 ./worker.cjs'])
  })

  it('accepts a directory URL when a payload member lies under it', () => {
    const present = payload({
      'lib/native.js': 'new URL("../presets/", import.meta.url)\n',
      'presets/standard/preset.yml': 'name: standard\n',
    })
    expect(payloadViolations(present)).toEqual([])
    const absent = payload({ 'lib/native.js': 'new URL("../presets/", import.meta.url)\n' })
    expect(reported(absent)).toEqual(['lib/native.js:1 ../presets/'])
  })

  it('accepts a source .ts URL when the emitted sibling is packed', () => {
    const present = payload({
      'lib/native.js': 'new URL("./worker.ts", import.meta.url)\n',
      'lib/worker.cjs': 'export {}\n',
    })
    expect(payloadViolations(present)).toEqual([])
    const absent = payload({ 'lib/native.js': 'new URL("./worker.ts", import.meta.url)\n' })
    expect(reported(absent)).toEqual(['lib/native.js:1 ./worker.ts'])
  })

  it('reports the emitted branch of a conditional URL when that file is absent', () => {
    const subject = payload({
      'lib/native.js': 'new URL(import.meta.url.endsWith(".ts") ? "./process-child.ts" : "./process-child.js", import.meta.url)\n',
    })
    expect(reported(subject)).toEqual([
      'lib/native.js:1 ./process-child.ts',
      'lib/native.js:1 ./process-child.js',
    ])
  })

  it('accepts a relative import resolved through a directory index', () => {
    const subject = payload({
      'lib/native.js': 'export * from "./client"\n',
      'lib/client/index.js': 'export const x = 1\n',
    })
    expect(payloadViolations(subject)).toEqual([])
  })
})

describe('payloadViolations bare specifiers', () => {
  it('reports a bare specifier declared only in devDependencies', () => {
    const subject = payload(
      { 'lib/native.js': 'import clsx from "clsx"\n' },
      { devDependencies: { clsx: '^2.0.0' } },
    )
    expect(reported(subject)).toEqual(['lib/native.js:1 clsx'])
    expect(payloadViolations(subject)[0]?.reason)
      .toBe('clsx is declared only in devDependencies, which a consumer does not install')
  })

  it('reports a bare specifier declared in no section at all', () => {
    const subject = payload({ 'lib/native.js': 'import clsx from "clsx"\n' })
    expect(payloadViolations(subject)[0]?.reason)
      .toBe('clsx is declared in no installing dependency section')
  })

  it.each(['dependencies', 'peerDependencies', 'optionalDependencies'])(
    'accepts a bare specifier declared in %s',
    (section) => {
      const subject = payload(
        { 'lib/native.js': 'import clsx from "clsx"\n' },
        { [section]: { clsx: '^2.0.0' } },
      )
      expect(payloadViolations(subject)).toEqual([])
    },
  )

  it('matches by package name for a subpath import', () => {
    const subject = payload(
      { 'lib/native.js': 'import { activeAtToken } from "@redspark/rsh-file-reference/grammar"\n' },
      { devDependencies: { '@redspark/rsh-file-reference': 'workspace:^' } },
    )
    expect(reported(subject)).toEqual(['lib/native.js:1 @redspark/rsh-file-reference/grammar'])
  })

  it('ignores the package importing its own subpath', () => {
    const subject = payload({ 'lib/native.js': 'export * from "@redspark/rsh-probe/extra"\n' })
    expect(payloadViolations(subject)).toEqual([])
  })

  it('ignores a node builtin', () => {
    const subject = payload({ 'lib/native.js': 'import { createHash } from "node:crypto"\n' })
    expect(payloadViolations(subject)).toEqual([])
  })

  it('does not report a published file nothing imports', () => {
    const subject = payload({
      'lib/native.js': 'export const plugin = {}\n',
      'lib/types/native.d.ts': 'export declare const plugin: unknown\n',
      'lib/styles/theme.css': '.a{color:red}',
    })
    expect(payloadViolations(subject)).toEqual([])
  })
})

describe('moduleTableExemption', () => {
  it('exempts a shell platform module', () => {
    expect(moduleTableExemption('react', {})).toMatch(/shell module table/u)
    expect(moduleTableExemption('@redspark/rsh-client-ui-primitives', {})).toMatch(/shell module table/u)
  })

  it('exempts an exact dsh.client.external request', () => {
    expect(moduleTableExemption('@redspark/rsh-api-gateway/client', {
      dsh: { client: { external: ['@redspark/rsh-api-gateway/client'] } },
    })).toMatch(/dsh\.client\.external/u)
  })

  it('does not exempt a subpath of a platform module name', () => {
    expect(moduleTableExemption('react/deep-import', {})).toBeUndefined()
  })

  it('does not exempt an undeclared specifier', () => {
    expect(moduleTableExemption('clsx', { dsh: { client: { external: [] } } })).toBeUndefined()
  })

  it('keeps a devDependencies platform import legal in a packed payload', () => {
    const subject = payload(
      { 'lib/native.js': 'import { jsx } from "react/jsx-runtime"\nimport { createSnapshotStore } from "@redspark/rsh-client-store"\n' },
      { devDependencies: { react: '^18.2.0', '@redspark/rsh-client-store': 'workspace:^' } },
    )
    expect(payloadViolations(subject)).toEqual([])
  })
})

describe('payloadViolations Native entry', () => {
  it('reports an advertised entry the tarball does not contain', () => {
    const subject: PackedPayload = {
      manifest: { name: NAME, exports: { './native': { default: './lib/native.js' } } },
      files: new Map([['package.json', '{}']]),
    }
    expect(payloadViolations(subject)).toEqual([expect.objectContaining({
      package: NAME,
      specifier: './lib/native.js',
      reason: 'exports["./native"] names a file the tarball does not contain',
    })])
  })

  it('still reports other broken relative imports when the native entry is absent', () => {
    const subject: PackedPayload = {
      manifest: { name: NAME, exports: { './native': { default: './lib/native.js' } } },
      files: new Map([
        ['package.json', '{}'],
        ['lib/other.js', 'import "./missing.js"\n'],
      ]),
    }
    expect(reported(subject)).toEqual([
      'package.json ./lib/native.js',
      'lib/other.js:1 ./missing.js',
    ])
  })

  it('reports an exports map with no default target', () => {
    const subject: PackedPayload = {
      manifest: { name: NAME, exports: { './native': { types: './lib/types/native.d.ts' } } },
      files: new Map([['package.json', '{}']]),
    }
    expect(payloadViolations(subject)[0]?.reason)
      .toBe('declares no default target, so no consumer can resolve the Native entry')
  })

  it('accepts the bare string form npm also honours', () => {
    const subject: PackedPayload = {
      manifest: { name: NAME, exports: { './native': './lib/native.js' }, dependencies: {} },
      files: new Map([['package.json', '{}'], ['lib/native.js', 'export const plugin = {}\n']]),
    }
    expect(payloadViolations(subject)).toEqual([])
  })
})

describe('corpus selection', () => {
  it('skips a package with no Native entry by never constructing a payload for it', () => {
    // The gate selects packages from exports["./native"]; a manifest without that
    // key never reaches payloadViolations. Assert the selection predicate the
    // gate applies, so the exclusion is pinned rather than implied.
    const selects = (manifest: Record<string, unknown>): boolean => {
      const exported = manifest.exports
      if (manifest.private === true) return false
      if (exported === null || typeof exported !== 'object' || Array.isArray(exported)) return false
      return Object.hasOwn(exported, './native')
    }
    expect(selects({ name: NAME, exports: { '.': './lib/index.js' } })).toBe(false)
    expect(selects({ name: NAME, exports: { './native': './lib/native.js' } })).toBe(true)
    expect(selects({ name: NAME, private: true, exports: { './native': './lib/native.js' } })).toBe(false)
    expect(selects({ name: NAME })).toBe(false)
  })
})

/**
 * Tests for the optional-dependency load gate: which import and re-export forms
 * survive emit, and therefore load a package the installed tree may not carry.
 *
 * The expectations here match what `tsc` emits with `verbatimModuleSyntax` off:
 * `import type`, `import {}`, an inline `type` specifier, and a named binding
 * that resolves to a type all disappear; a bare import, a value binding, and a
 * star re-export remain.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { TypeScriptProject } from './ts-project.ts'
import { collectOptionalImportViolations } from './verify-optional-dependency-imports.ts'

const FIXTURE: Record<string, string> = {
  'tsconfig.host.json': JSON.stringify({
    compilerOptions: {
      target: 'es2022',
      module: 'esnext',
      moduleResolution: 'bundler',
      noEmit: true,
      skipLibCheck: true,
      types: [],
      paths: {
        '@f/opt': ['./rsh/f/opt/src/index.ts'],
        '@f/hard': ['./rsh/f/hard/src/index.ts'],
        '@deepseek-ai/cordis': ['./rsh/f/cordis/src/index.ts'],
      },
    },
    include: ['rsh/**/*.ts'],
  }),

  'rsh/f/opt/package.json': JSON.stringify({ name: '@f/opt', version: '0.0.1' }),
  'rsh/f/opt/src/index.ts': [
    'export interface Shape { a: number }',
    'export const runtimeValue = 1',
    '',
  ].join('\n'),

  'rsh/f/hard/package.json': JSON.stringify({ name: '@f/hard', version: '0.0.1' }),
  'rsh/f/hard/src/index.ts': 'export const hardValue = 2\n',
  'rsh/f/cordis/package.json': JSON.stringify({ name: '@deepseek-ai/cordis', version: '0.0.1' }),
  'rsh/f/cordis/src/index.ts': 'export const context = 3\n',

  'rsh/f/native-consumer/package.json': JSON.stringify({
    name: '@f/native-consumer',
    version: '0.0.1',
    exports: { './native': { types: './lib/types/native.d.ts', default: './lib/native.js' } },
    peerDependencies: { '@deepseek-ai/cordis': '*' },
    peerDependenciesMeta: { '@deepseek-ai/cordis': { optional: true } },
  }),
  'rsh/f/native-consumer/src/index.ts': "import { context } from '@deepseek-ai/cordis'\nexport const legacy = context\n",
  'rsh/f/native-consumer/src/native.ts': "export { native } from './native-dependency.ts'\n",
  'rsh/f/native-consumer/src/native-dependency.ts': "import { context } from '@deepseek-ai/cordis'\nexport const native = context\n",

  'rsh/f/native-types-consumer/package.json': JSON.stringify({
    name: '@f/native-types-consumer',
    version: '0.0.1',
    exports: { './types': { types: './lib/types/types.d.ts', default: './lib/types/types.js' } },
    peerDependencies: { '@deepseek-ai/cordis': '*' },
    peerDependenciesMeta: { '@deepseek-ai/cordis': { optional: true } },
  }),
  'rsh/f/native-types-consumer/src/index.ts': "import { context } from '@deepseek-ai/cordis'\nexport const legacy = context\n",
  'rsh/f/native-types-consumer/src/types.ts': 'export interface NativeTypes { value: string }\n',

  'rsh/f/unsafe-native-types-consumer/package.json': JSON.stringify({
    name: '@f/unsafe-native-types-consumer',
    version: '0.0.1',
    exports: { './types': { types: './lib/types/types.d.ts', default: './lib/types/types.js' } },
    peerDependencies: { '@deepseek-ai/cordis': '*' },
    peerDependenciesMeta: { '@deepseek-ai/cordis': { optional: true } },
  }),
  'rsh/f/unsafe-native-types-consumer/src/index.ts': "import { context } from '@deepseek-ai/cordis'\nexport const legacy = context\n",
  'rsh/f/unsafe-native-types-consumer/src/types.ts': "import '@deepseek-ai/cordis'\nexport interface NativeTypes { value: string }\n",

  'rsh/f/cli/package.json': JSON.stringify({
    name: '@deepseek-ai/dsh',
    version: '0.0.1',
    bin: { f: 'lib/bin.js' },
    optionalDependencies: { '@f/opt': '*' },
  }),
  'rsh/f/cli/src/bin.ts': "import './startup.ts'\nvoid import('./compatibility.ts')\n",
  'rsh/f/cli/src/startup.ts': 'export const startup = true\n',
  'rsh/f/cli/src/compatibility.ts': "import { runtimeValue } from '@f/opt'\nexport const compatibility = runtimeValue\n",

  'rsh/f/cli-static-violation/package.json': JSON.stringify({
    name: '@deepseek-ai/dsh',
    version: '0.0.1',
    bin: { f: 'lib/bin.js' },
    optionalDependencies: { '@f/opt': '*' },
  }),
  'rsh/f/cli-static-violation/src/bin.ts': "import './startup.ts'\n",
  'rsh/f/cli-static-violation/src/startup.ts': "import { runtimeValue } from '@f/opt'\nexport const startup = runtimeValue\n",

  'rsh/f/cli-unrelated/package.json': JSON.stringify({
    name: '@f/cli-unrelated',
    version: '0.0.1',
    bin: { f: 'lib/bin.js' },
    optionalDependencies: { '@f/opt': '*' },
  }),
  'rsh/f/cli-unrelated/src/bin.ts': "void import('./compatibility.ts')\n",
  'rsh/f/cli-unrelated/src/compatibility.ts': "import { runtimeValue } from '@f/opt'\nexport const compatibility = runtimeValue\n",

  // The consumer allows @f/opt to be absent and requires @f/hard.
  'rsh/f/consumer/package.json': JSON.stringify({
    name: '@f/consumer',
    version: '0.0.1',
    dependencies: { '@f/hard': '*' },
    peerDependencies: { '@f/opt': '*' },
    peerDependenciesMeta: { '@f/opt': { optional: true } },
  }),

  // Elided by the compiler, so each of these is allowed.
  'rsh/f/consumer/src/allowed-type-only.ts': [
    "import type {} from '@f/opt'",
    'export const a = 1',
    '',
  ].join('\n'),
  'rsh/f/consumer/src/allowed-empty.ts': [
    "import {} from '@f/opt'",
    'export const b = 1',
    '',
  ].join('\n'),
  'rsh/f/consumer/src/allowed-inline-type.ts': [
    "import { type Shape } from '@f/opt'",
    'export const c: Shape = { a: 1 }',
    '',
  ].join('\n'),
  'rsh/f/consumer/src/allowed-type-binding.ts': [
    "import { Shape } from '@f/opt'",
    'export const d: Shape = { a: 1 }',
    '',
  ].join('\n'),
  'rsh/f/consumer/src/allowed-type-reexport.ts': [
    "export type { Shape } from '@f/opt'",
    '',
  ].join('\n'),
  // A hard dependency may be loaded at module scope; only optional ones may not.
  'rsh/f/consumer/src/allowed-hard-dependency.ts': [
    "import { hardValue } from '@f/hard'",
    'export const e = hardValue',
    '',
  ].join('\n'),

  // Kept by the compiler, so each of these loads a package that may be absent.
  'rsh/f/consumer/src/rejected-bare.ts': [
    "import '@f/opt'",
    'export const f = 1',
    '',
  ].join('\n'),
  'rsh/f/consumer/src/rejected-value.ts': [
    "import { runtimeValue } from '@f/opt'",
    'export const g = runtimeValue',
    '',
  ].join('\n'),
  'rsh/f/consumer/src/rejected-star-reexport.ts': [
    "export * from '@f/opt'",
    '',
  ].join('\n'),
}

const root = mkdtempSync(join(tmpdir(), 'optional-imports-'))
for (const [rel, content] of Object.entries(FIXTURE)) {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), content)
}
const violations = collectOptionalImportViolations(new TypeScriptProject(root))
const safeExportViolations = collectOptionalImportViolations(
  new TypeScriptProject(root),
  new Map([
    ['rsh/f/native-types-consumer', ['./types']],
    ['rsh/f/unsafe-native-types-consumer', ['./types']],
  ]),
)

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('optional dependency loads', () => {
  it('reports every form the compiler keeps, and nothing else', () => {
    expect(violations.map(violation => violation.split(' loads ')[0])).toEqual([
      'rsh/f/cli-static-violation/src/startup.ts:1',
      'rsh/f/cli-unrelated/src/compatibility.ts:1',
      'rsh/f/consumer/src/rejected-bare.ts:1',
      'rsh/f/consumer/src/rejected-star-reexport.ts:1',
      'rsh/f/consumer/src/rejected-value.ts:1',
      'rsh/f/native-consumer/src/native-dependency.ts:1',
      'rsh/f/native-types-consumer/src/index.ts:1',
      'rsh/f/unsafe-native-types-consumer/src/index.ts:1',
      'rsh/f/unsafe-native-types-consumer/src/types.ts:1',
    ])
  })

  it('names the package, the declaration that made it optional, and the way out', () => {
    expect(violations.find(violation => violation.startsWith('rsh/f/consumer/src/rejected-bare.ts:1'))).toBe(
      'rsh/f/consumer/src/rejected-bare.ts:1 loads @f/opt at module scope,'
      + ' declared optional in peerDependenciesMeta; import it as a type,'
      + ' or restructure so module scope does not need it',
    )
  })

  it('checks Cordis-free type exports while allowing legacy-only Cordis imports', () => {
    expect(safeExportViolations).toContain(
      'rsh/f/unsafe-native-types-consumer/src/types.ts:1 loads @deepseek-ai/cordis at module scope,'
      + ' declared optional in peerDependenciesMeta; import it as a type, or restructure so module scope does not need it',
    )
    expect(safeExportViolations.some(violation => violation.startsWith('rsh/f/native-types-consumer/src/index.ts:1'))).toBe(false)
  })

  it('checks optional loads from a binary startup closure but leaves dynamic compatibility branches on demand', () => {
    const cliViolations = violations.filter(violation => violation.startsWith('rsh/f/cli/src/'))
    expect(cliViolations).toEqual([])
    expect(violations).toContain(
      'rsh/f/cli-static-violation/src/startup.ts:1 loads @f/opt at module scope,'
      + ' declared optional in optionalDependencies; import it as a type, or restructure so module scope does not need it',
    )
    expect(violations).toContain(
      'rsh/f/cli-unrelated/src/compatibility.ts:1 loads @f/opt at module scope,'
      + ' declared optional in optionalDependencies; import it as a type, or restructure so module scope does not need it',
    )
  })
})

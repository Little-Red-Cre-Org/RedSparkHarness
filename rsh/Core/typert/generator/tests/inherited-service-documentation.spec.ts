/** Service catalogs use the declared interface documentation without bypassing completeness checks. */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { collectServices, type CordisCatalogPolicy } from '../src/cordis-catalog.ts'

const policy: CordisCatalogPolicy = { linkedTypePages: {}, foundationTypeNames: new Set(['Promise']),
  typeLinkExemptions: {}, inheritedEvents: [], inheritedServices: [] }

function project(documentation: string, generic: boolean = false) {
  const root = mkdtempSync(join(tmpdir(), 'rsh-inherited-service-'))
  const directory = join(root, 'rsh/Modules/Official/fixture/service')
  mkdirSync(join(directory, 'src'), { recursive: true })
  writeFileSync(join(root, 'tsconfig.host.json'), JSON.stringify({ files: [], references: [{ path: './rsh/Modules/Official/fixture/service' }] }))
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-fixture-service', private: true,
    type: 'module', exports: { '.': { types: './lib/types/index.d.ts', default: './lib/index.js' } } }))
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { composite: true,
    module: 'ESNext', moduleResolution: 'Bundler', rootDir: 'src', target: 'ES2022' }, include: ['src'] }))
  writeFileSync(join(directory, 'src/index.ts'), `
    /** Shared read operations. */
    export interface Operations${generic ? '<Value>' : ''} {
      ${documentation}
      read(id: string): Promise<${generic ? 'Value' : 'string'}>
    }
    /** Compatibility service shares the read operations. */
    export abstract class FixtureService implements Operations${generic ? '<string>' : ''} {
      /** @inheritdoc */
      abstract read(id: string): Promise<string>
    }
    declare module '@deepseek-ai/cordis' { interface Context { fixture: FixtureService } }
  `)
  try { return collectServices(root, policy) }
  finally { rmSync(root, { recursive: true, force: true }) }
}

it('projects implemented interface documentation for an explicit inheritdoc member', () => {
  const services = project('/** Read one value.\n * @param id - exact value identifier.\n * @returns the stored value.\n */')
  expect(services).toHaveLength(1)
  expect(services[0]?.methods).toHaveLength(1)
  expect(services[0]?.methods[0]?.jsDoc).toContain('Read one value.')
  expect(services[0]?.methods[0]?.jsDoc).toContain('@param id')
  expect(services[0]?.methods[0]?.jsDoc).toContain('@returns')
})

it('rejects inheritdoc when the declaring interface omits required method documentation', () => {
  expect(() => project('/** Read one value. */')).toThrow('missing @param id')
})

it('retains the authored service signature when documentation comes from a generic interface', () => {
  const services = project('/** Read one value.\n * @param id - exact value identifier.\n * @returns the stored value.\n */', true)
  expect(services[0]?.methods[0]?.signature).toContain('Promise<string>')
  expect(services[0]?.methods[0]?.signature).not.toContain('Value')
  expect(services[0]?.methods[0]?.jsDoc).toContain('@returns')
})

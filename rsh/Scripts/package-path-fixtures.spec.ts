import { expect, it } from 'vitest'
import { isSyntheticPackageReference } from './package-path-fixtures.ts'

it('exempts only synthetic references in their owning tests', () => {
  const owners = [
    ['rsh/Core/typert/generator/tests/type-model.spec.ts', ['packages', 'client', 'src/index.ts']],
    ['rsh/Core/typert/generator/tests/tsdown-plugin.spec.ts', ['packages', 'core', 'tools']],
    ['rsh/Programs/Web/client/modules/tests/node-half.client.spec.ts', ['packages', 'client', 'generated-0']],
  ] as const
  for (const [file, parts] of owners) {
    expect(isSyntheticPackageReference(file, parts.join('/'))).toBe(true)
    expect(isSyntheticPackageReference('README.md', parts.join('/'))).toBe(false)
    expect(isSyntheticPackageReference(file, ['packages', 'core', 'agent'].join('/'))).toBe(false)
  }
  expect(isSyntheticPackageReference(owners[0][0], ['packages', 'client-other'].join('/'))).toBe(false)
})

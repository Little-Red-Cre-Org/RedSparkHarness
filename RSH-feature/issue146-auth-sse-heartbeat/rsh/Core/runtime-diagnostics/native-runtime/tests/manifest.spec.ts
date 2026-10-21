/** Static metadata refusal before native entry import. */
import { expect, it } from 'vitest'
import { parseNativeEntryManifest, validateNativePluginEntry } from '../src/index.ts'

const declaration = {
  apiVersion: 1, entry: './native', targets: ['host'], requires: ['value'], optional: [], provides: [],
}

it('checks native JSON metadata before loading a published entry', () => {
  const exports = new Set(['.', './native'])
  expect(parseNativeEntryManifest(declaration, exports)).toEqual(declaration)
  expect(() => parseNativeEntryManifest({ ...declaration, entry: './private' }, exports)).toThrow('published package export')
  expect(() => parseNativeEntryManifest({ ...declaration, entry: '../native' }, exports)).toThrow('published package export')
  expect(() => parseNativeEntryManifest({ ...declaration, extra: true }, exports)).toThrow('unknown native manifest field extra')
  expect(() => parseNativeEntryManifest({ ...declaration, apiVersion: 2 }, exports)).toThrow('unsupported native manifest version')
  expect(() => parseNativeEntryManifest({ ...declaration, targets: [] }, exports)).toThrow('targets')
  expect(() => parseNativeEntryManifest({ ...declaration, requires: ['value', 'value'] }, exports)).toThrow('repeats a name')
  expect(() => parseNativeEntryManifest({ ...declaration, optional: ['value'] }, exports)).toThrow('overlap')
})

it('refuses a loaded entry whose runtime declarations differ from the package metadata', () => {
  const manifest = parseNativeEntryManifest(declaration, new Set(['./native']))
  const plugin = { name: 'consumer', apiVersion: 1, targets: ['host'], requires: ['value'], provides: [], resolve: () => () => {} }
  expect(validateNativePluginEntry(plugin, manifest)).toBe(plugin)
  expect(() => validateNativePluginEntry({ ...plugin, requires: [] }, manifest)).toThrow('entry requires differs')
  expect(() => validateNativePluginEntry({ ...plugin, targets: ['client'] }, manifest)).toThrow('entry targets differs')
  expect(() => validateNativePluginEntry({ ...plugin, resolve: undefined }, manifest)).toThrow('configuration resolver')
})

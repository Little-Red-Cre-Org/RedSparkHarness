/** Translate the installed Code OSS message indices using its installed language pack. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Project upstream module/key translations onto the matching runtime's message indices.
 * @param config - native provider configuration containing runtime and data directories.
 * @param language - installed Code OSS language identifier.
 * @returns a same-origin bootstrap script with upstream English for untranslated keys.
 */
export async function loadIdeLanguage(config: object, language: string): Promise<string> {
  if (!('runtimeDirectory' in config) || typeof config.runtimeDirectory !== 'string'
    || !('dataDirectory' in config) || typeof config.dataDirectory !== 'string') {
    throw new Error('IDE language requires runtimeDirectory and dataDirectory')
  }
  const root = join(config.dataDirectory, 'extensions')
  const registry: unknown = JSON.parse(await readFile(join(root, 'extensions.json'), 'utf8'))
  if (!Array.isArray(registry)) throw new Error('Invalid IDE extension registry')
  const pack: unknown = registry.find((entry: unknown) => typeof entry === 'object' && entry !== null
    && 'identifier' in entry && typeof entry.identifier === 'object' && entry.identifier !== null
    && 'id' in entry.identifier && entry.identifier.id === 'ms-ceintl.vscode-language-pack-zh-hans')
  if (typeof pack !== 'object' || pack === null || !('relativeLocation' in pack)
    || typeof pack.relativeLocation !== 'string' || !/^[a-z0-9._-]+$/i.test(pack.relativeLocation)) {
    throw new Error('IDE Simplified Chinese language pack is missing')
  }
  const [keys, defaults, translated]: unknown[] = await Promise.all([
    readFile(join(config.runtimeDirectory, 'out', 'nls.keys.json'), 'utf8'),
    readFile(join(config.runtimeDirectory, 'out', 'nls.messages.json'), 'utf8'),
    readFile(join(root, pack.relativeLocation, 'translations', 'main.i18n.json'), 'utf8'),
  ]).then(values => values.map(value => JSON.parse(value) as unknown))
  if (!Array.isArray(keys) || !Array.isArray(defaults) || !defaults.every(value => typeof value === 'string')
    || typeof translated !== 'object' || translated === null || !('contents' in translated)
    || typeof translated.contents !== 'object' || translated.contents === null) throw new Error('Invalid IDE language messages')
  const messages: string[] = []
  for (const entry of keys) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Array.isArray(entry[1])) throw new Error('Invalid IDE NLS keys')
    const section: unknown = Reflect.get(translated.contents, entry[0])
    for (const key of entry[1]) {
      if (typeof key !== 'string') throw new Error('Invalid IDE NLS key')
      const value: unknown = typeof section === 'object' && section !== null ? Reflect.get(section, key) : undefined
      const fallback: unknown = defaults[messages.length]
      if (typeof fallback !== 'string') throw new Error('IDE NLS indices do not match')
      messages.push(typeof value === 'string' && value !== '' ? value : fallback)
    }
  }
  if (messages.length !== defaults.length) throw new Error('IDE NLS indices do not match')
  return `globalThis._VSCODE_NLS_MESSAGES=${JSON.stringify(messages)};globalThis._VSCODE_NLS_LANGUAGE=${JSON.stringify(language)};`
}

/** Refuse Cordis Context construction in a separate process without editing vendored code. */
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context)
  if (!url.replaceAll('\\', '/').endsWith('/rsh/Core/vendor/cordis/lib/index.js')) return result
  const source = String(result.source)
  const marker = 'var Context = class Context {'
  const start = source.indexOf(marker)
  if (start < 0) throw new Error('Cordis constructor probe cannot find Context class')
  const constructor = source.indexOf('constructor() {', start)
  if (constructor < 0) throw new Error('Cordis constructor probe cannot find Context constructor')
  const insertion = constructor + 'constructor() {'.length
  return {
    ...result,
    source: `${source.slice(0, insertion)} throw new Error('CORDIS_CONTEXT_CONSTRUCTED');${source.slice(insertion)}`,
  }
}

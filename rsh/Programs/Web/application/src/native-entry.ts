/** Browser entry adapter for the Host-injected native Client profile. */
import { bootNativeClient } from '@deepseek-ai/dsh-client-web/native'
import type {
  NativeClientBootOptions,
  NativeClientBootWire,
  NativeClientHost,
  NativeClientModuleSource,
  NativeClientSelection,
} from '@deepseek-ai/dsh-client-web/native'

const NATIVE_MODULE_PATH = '/.dsh/native-client/'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function bootUrl(value: unknown, label: string, baseUrl: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`native web: ${label} must be a nonempty string`)
  }
  let base: URL
  try {
    base = new URL(baseUrl)
  } catch (error) {
    throw new Error(`native web: invalid base URL for ${label}`, { cause: error })
  }
  let url: URL
  try {
    url = new URL(value, base)
  } catch (error) {
    throw new Error(`native web: invalid URL for ${label}`, { cause: error })
  }
  if (url.origin !== base.origin || !url.pathname.startsWith(NATIVE_MODULE_PATH)
    || url.username !== '' || url.password !== '' || url.hash !== '') {
    throw new Error(`native web: ${label} is outside the native module route`)
  }
  return url.href
}

/** Read and validate data injected across the Host/browser boundary. */
function parseNativeClientBootWire(value: unknown, baseUrl: string): NativeClientBootWire {
  if (!isRecord(value)) throw new Error('native web: injected boot data must be an object')
  if (Object.keys(value).some(key => !['formatVersion', 'bundle', 'styles', 'modules', 'selections'].includes(key))) {
    throw new Error('native web: injected boot data has unknown fields')
  }
  if (value.formatVersion !== 1) throw new Error('native web: unsupported injected boot format')
  if (typeof value.bundle !== 'string') throw new Error('native web: bundle must be a nonempty string')
  if (!Array.isArray(value.styles) || !Array.isArray(value.modules) || !Array.isArray(value.selections)) {
    throw new Error('native web: styles, modules, and selections must be arrays')
  }
  const bundle = bootUrl(value.bundle, 'bundle', baseUrl)
  const styles = value.styles.map(style => bootUrl(style, 'stylesheet', baseUrl))
  if (new Set(styles).size !== styles.length) throw new Error('native web: stylesheets must be unique')
  const modules = value.modules.map((value): { readonly id: string } => {
    if (!isRecord(value)) throw new Error('native web: module row must be an object')
    if (Object.keys(value).some(key => key !== 'id')) throw new Error('native web: module row has unknown fields')
    if (typeof value.id !== 'string' || value.id.length === 0) {
      throw new Error('native web: module row requires a nonempty id')
    }
    return { id: value.id }
  })
  if (new Set(modules.map(row => row.id)).size !== modules.length) {
    throw new Error('native web: module ids must be unique')
  }
  const selections = value.selections.map((value): NativeClientSelection => {
    if (!isRecord(value)) throw new Error('native web: selection row must be an object')
    if (Object.keys(value).some(key => !['id', 'config'].includes(key))) {
      throw new Error('native web: selection row has unknown fields')
    }
    if (typeof value.id !== 'string' || value.id.length === 0) {
      throw new Error('native web: selection row requires a nonempty id')
    }
    return { id: value.id, config: value.config }
  })
  if (new Set(selections.map(row => row.id)).size !== selections.length) {
    throw new Error('native web: selection ids must be unique')
  }
  return { formatVersion: 1, bundle, styles, modules, selections }
}

function bundlePlugins(value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value) || !isRecord(value.plugins)) {
    throw new Error('native web: Host module bundle must export a plugin table')
  }
  return value.plugins
}

interface InstalledStyles {
  readonly ready: Promise<void>
  dispose(): void
}

function installStyles(urls: readonly string[]): InstalledStyles {
  const links: HTMLLinkElement[] = []
  const ready = Promise.all(urls.map(url => new Promise<void>((resolvePromise, rejectPromise) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = url
    link.addEventListener('load', () => { resolvePromise() }, { once: true })
    link.addEventListener('error', () => { rejectPromise(new Error(`native web: stylesheet failed to load ${url}`)) }, { once: true })
    links.push(link)
    document.head.append(link)
  }))).then(() => undefined)
  return { ready, dispose: () => { for (const link of links) link.remove() } }
}

async function waitForStyles(ready: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (signal === undefined) return ready
  signal.throwIfAborted()
  let rejectAbort!: (error: Error) => void
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
  const onAbort = (): void => {
    rejectAbort(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)))
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    await Promise.race([ready, aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/** Import a browser module bundle supplied by the Host. */
/* v8 ignore next -- browser-only remote ESM loading is exercised by native-web-production.e2e.ts */
function importNativeBundle(url: string): Promise<unknown> {
  return import(/* @vite-ignore */ url) as Promise<unknown>
}

/**
 * Start the native Client selections and mount their renderer.
 * @param container - browser application mount point.
 * @param value - Host-injected profile data read from the document global.
 * @param baseUrl - document URL used to constrain module imports to the Host route.
 * @param importModule - test seam replacing browser ESM loading.
 * @param signal - skips activation after pending imports settle and owns the active composition lifetime.
 * @returns the active native host; its caller must await {@link NativeClientHost.stop}.
 */
export async function bootNativeClientEntry(
  container: HTMLElement,
  value: unknown,
  baseUrl = document.baseURI,
  importModule: (url: string) => Promise<unknown> = importNativeBundle,
  signal?: AbortSignal,
): Promise<NativeClientHost> {
  signal?.throwIfAborted()
  const wire = parseNativeClientBootWire(value, baseUrl)
  const styles = installStyles(wire.styles)
  try {
    if (wire.styles.length > 0) await waitForStyles(styles.ready, signal)
    signal?.throwIfAborted()
    const bundle = bundlePlugins(await importModule(wire.bundle))
    const modules: NativeClientModuleSource = {
      manifest: { modules: wire.modules },
      import: (specifier) => {
        const entry = bundle[specifier]
        if (entry === undefined) throw new Error(`native web: Host bundle omitted module ${specifier}`)
        return Promise.resolve(entry)
      },
    }
    const options: NativeClientBootOptions = {
      modules, selections: wire.selections, container,
      ...(signal === undefined ? {} : { signal }),
    }
    const host = await bootNativeClient(options)
    return {
      diagnostics: () => host.diagnostics(),
      stop: async () => {
        try { await host.stop() }
        finally { styles.dispose() }
      },
    }
  } catch (error) {
    styles.dispose()
    throw error
  }
}

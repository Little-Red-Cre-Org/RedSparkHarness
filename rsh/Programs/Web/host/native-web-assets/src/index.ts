/** Cordis-free Desktop routes for a selected native Client page and built frontend assets. */
import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import type { NativeClientBundle } from './native-client.ts'

export type { NativeClientAsset, NativeClientBundle } from './native-client.ts'

type NativeClientBundleBuilder = typeof import('./native-client.ts').prepareNativeClientBundle

/**
 * Load the profile bundler only when a Host selects a native Client profile.
 * @param args - profile-owned project directory and installed runtime root passed to the bundler.
 * @returns the selected native browser graph, or undefined when no Client profile exists.
 */
export const prepareNativeClientBundle: NativeClientBundleBuilder = (...args) =>
  import('./native-client.ts').then(module => module.prepareNativeClientBundle(...args))

export type {
  NativeConnectionFetchHandler,
  NativeConnectionHandle,
  NativeConnectionOwner,
  NativeConnectionRegistry,
  NativeHttpAssetHandler,
  NativeHttpBridge,
  NativeHttpHost,
  NativeHttpHostConfig,
} from './native-http.ts'
export { listenNativeHttpHost } from './native-http.ts'

/** Native asset handler with an atomic bundle publication operation. */
export interface NativeDesktopAssetHandler {
  requestBodyMode(): 'buffered'
  fetch(request: Request): Promise<Response>
  update(bundle: NativeClientBundle): void
}

const HTML_CONTENT_TYPE = 'text/html; charset=utf-8'
const MIME: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
}

/** Routes shared by the legacy Host and a future native Host selection. */
export interface DesktopAssetRoutes {
  /** Read the installed legacy index for its owning Host to transform. */
  readLegacyIndex(): Promise<string>
  /** Serve a native route or existing static asset; leave unmatched routes to the caller. */
  fetchKnown(request: Request): Promise<Response | undefined>
  /** Render the selected native page for the native Host's fallback route. */
  renderNativeIndex(method: string): Promise<Response>
}

type AssetRoutes = Pick<DesktopAssetRoutes, 'fetchKnown' | 'renderNativeIndex'>

function nativePage(html: string, bundle: NativeClientBundle, transportScript: string): string {
  const head = /<head(?:\s[^>]*)?>/iu.exec(html)
  if (head === null) throw new Error('dsh desktop: native frontend has no head element')
  if (/<\/script/iu.test(transportScript)) throw new Error('dsh desktop: transport script closes its element')
  const wire = JSON.stringify(bundle.wire).replaceAll('<', '\\u003c')
  const markup = `<script>${transportScript}</script><script>globalThis.__DSH_NATIVE_CLIENT_BOOT__ = ${wire}</script>`
  const at = head.index + head[0].length
  return `${html.slice(0, at)}${markup}${html.slice(at)}`
}

/**
 * Resolve only packages installed in the supplied runtime and serve their native page and files.
 * @param runtimeDir - installed Desktop runtime root.
 * @param nativeClient - selected Client bundle, when one is configured.
 * @param transportScript - Host-owned browser transport installed before native-main executes.
 * @returns the reusable native and static route operations.
 */
function createAssetRoutes(
  runtimeDir: string,
  nativeClient: NativeClientBundle | undefined,
  transportScript: string,
): AssetRoutes {
  const require = createRequire(join(runtimeDir, 'package.json'))
  const distNativeIndex = nativeClient === undefined
    ? undefined
    : require.resolve('@deepseek-ai/dsh-web-frontend/dist/native.html')
  const distRoot = realpathSync(dirname(distNativeIndex
    ?? require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')))
  const renderNativeIndex = async (method: string): Promise<Response> => {
    if (distNativeIndex === undefined || nativeClient === undefined) return new Response(null, { status: 404 })
    const body = nativePage(await readFile(distNativeIndex, 'utf8'), nativeClient, transportScript)
    return new Response(method === 'HEAD' ? null : body, { headers: { 'content-type': HTML_CONTENT_TYPE } })
  }
  return {
    renderNativeIndex,
    async fetchKnown(request): Promise<Response | undefined> {
      const url = new URL(request.url)
      const nativeAsset = nativeClient?.assets.get(url.pathname)
      if (nativeAsset !== undefined) {
        let body: ArrayBuffer | null = null
        if (request.method !== 'HEAD') {
          const copy = new Uint8Array(nativeAsset.body.byteLength)
          copy.set(nativeAsset.body)
          body = copy.buffer
        }
        return new Response(body, { headers: { 'content-type': nativeAsset.contentType } })
      }
      if (url.pathname.startsWith('/.dsh/native-client/')) return new Response(null, { status: 404 })
      let pathname: string
      try {
        pathname = decodeURIComponent(url.pathname)
      } catch {
        return new Response(null, { status: 400 })
      }
      if (pathname === '/native.html') return renderNativeIndex(request.method)
      const target = resolve(normalize(join(distRoot, pathname)))
      if (target !== distRoot && !target.startsWith(distRoot + sep)) return new Response(null, { status: 403 })
      try {
        const realTarget = realpathSync(target)
        if (realTarget !== distRoot && !realTarget.startsWith(distRoot + sep)) return new Response(null, { status: 403 })
        return new Response(request.method === 'HEAD' ? null : await readFile(realTarget), {
          headers: { 'content-type': MIME[extname(realTarget)] ?? 'application/octet-stream' },
        })
      } catch {
        return undefined
      }
    },
  }
}

/**
 * Resolve the compatibility Host's legacy index and the selected native/static routes.
 * @param runtimeDir - installed Desktop runtime root.
 * @param nativeClient - selected Client bundle, when one is configured.
 * @param transportScript - Host-owned browser transport installed before native-main executes.
 * @returns legacy index access and the reusable native and static routes.
 */
export function createDesktopAssetRoutes(
  runtimeDir: string,
  nativeClient: NativeClientBundle | undefined,
  transportScript: string,
): DesktopAssetRoutes {
  const require = createRequire(join(runtimeDir, 'package.json'))
  const distIndex = require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')
  return {
    readLegacyIndex: () => readFile(distIndex, 'utf8'),
    ...createAssetRoutes(runtimeDir, nativeClient, transportScript),
  }
}

/**
 * Serve the selected native page without Cordis services or legacy plugin routes.
 * @param runtimeDir - installed Desktop runtime root.
 * @param nativeClient - validated Client bundle and emitted assets.
 * @param transportScript - Host-owned browser transport installed before native-main executes.
 * @returns a native-only GET and HEAD asset handler.
 */
export function createNativeDesktopAssetHandler(
  runtimeDir: string,
  nativeClient: NativeClientBundle,
  transportScript: string,
): NativeDesktopAssetHandler {
  let current = nativeClient
  let routes = createAssetRoutes(runtimeDir, current, transportScript)
  return {
    requestBodyMode: () => 'buffered',
    update(bundle) {
      current = bundle
      routes = createAssetRoutes(runtimeDir, current, transportScript)
    },
    async fetch(request): Promise<Response> {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
      const pathname = new URL(request.url).pathname
      if (pathname.startsWith('/plugins/')) return new Response(null, { status: 404 })
      if (pathname === '/' || pathname === '/index.html') return routes.renderNativeIndex(request.method)
      return await routes.fetchKnown(request) ?? routes.renderNativeIndex(request.method)
    },
  }
}

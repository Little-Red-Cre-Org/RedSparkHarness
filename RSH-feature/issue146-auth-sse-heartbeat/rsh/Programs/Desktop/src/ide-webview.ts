/** Configure upstream extension hosts and local webview assets for Desktop. */
import type { Session } from 'electron'

/**
 * Route TypeScript to the Node extension host and isolate local webview origins.
 * @param browser - IDE-only Electron session.
 * @param address - authenticated Code OSS entry URL.
 * @param nls - local upstream language-pack messages; absent for English.
 * @returns disposer withdrawing the session-owned protocol handlers.
 */
export function installIdeWebviews(browser: Session, address: string, nls?: string): () => void {
  const origin = new URL(address).origin
  let assetBase: URL | undefined
  browser.protocol.handle('http', async (request) => {
    const target = new URL(request.url)
    if (target.origin === origin && target.pathname === '/__rsh_nls.js' && nls !== undefined) {
      return new Response(nls, { headers: { 'content-type': 'text/javascript; charset=utf-8' } })
    }
    const response = await browser.fetch(request, { bypassCustomProtocolHandlers: true })
    if (target.origin !== origin || target.pathname !== '/' || !response.headers.get('content-type')?.includes('text/html')) return response
    const html = await response.text()
    const matcher = /(<meta id="vscode-workbench-web-configuration" data-settings=")([^"]*)(")/u
    const match = matcher.exec(html)
    const script = /src="([^"]*\/static)\/out\/vs\/code\/browser\/workbench\/workbench.js"/u.exec(html)
    if (match?.[2] === undefined || script?.[1] === undefined) throw new Error('Code OSS did not supply the expected workbench bootstrap configuration')
    assetBase = new URL(`${script[1]}/out/vs/workbench/contrib/webview/browser/pre/`, origin)
    const config: unknown = JSON.parse(match[2].replaceAll('&quot;', '"'))
    if (typeof config !== 'object' || config === null || Array.isArray(config)) throw new Error('Code OSS supplied invalid workbench configuration')
    const defaults = 'configurationDefaults' in config ? config.configurationDefaults : {}
    if (typeof defaults !== 'object' || defaults === null || Array.isArray(defaults)) throw new Error('Code OSS supplied invalid default configuration')
    const extensionKind = 'remote.extensionKind' in defaults ? defaults['remote.extensionKind'] : {}
    if (typeof extensionKind !== 'object' || extensionKind === null || Array.isArray(extensionKind)) throw new Error('Code OSS supplied invalid extension kinds')
    const localConfig = {
      ...config, webviewEndpoint: 'rsh-webview://{{uuid}}/',
      configurationDefaults: { ...defaults, 'remote.extensionKind': {
        ...extensionKind, 'vscode.typescript-language-features': ['workspace', '-web'],
      } },
    }
    let body = html.replace(matcher, (_text, before: string, _data: string, after: string) => `${before}${JSON.stringify(localConfig).replaceAll('"', '&quot;')}${after}`)
    if (nls !== undefined) {
      const localized = body.replace(/src="[^"]*\/out\/nls.messages.js"/u, 'src="/__rsh_nls.js"')
      if (localized === body) throw new Error('Code OSS did not supply its NLS bootstrap script')
      body = localized.replace(/<script type="module" src=""><\/script>/u, '')
    }
    const headers = new Headers(response.headers)
    headers.delete('content-length')
    const csp = headers.get('content-security-policy')
    if (csp !== null) headers.set('content-security-policy', csp.replace(/frame-src\s/gu, 'frame-src rsh-webview: '))
    return new Response(body, { status: response.status, headers })
  })
  browser.protocol.handle('rsh-webview', async (request) => {
    const target = new URL(request.url)
    if (assetBase === undefined || !['/index.html', '/fake.html', '/service-worker.js'].includes(target.pathname)) return new Response(null, { status: 404 })
    const resource = new URL(target.pathname.slice(1) + target.search, assetBase)
    return browser.fetch(resource.href, { bypassCustomProtocolHandlers: true })
  })
  return () => { browser.protocol.unhandle('http'); browser.protocol.unhandle('rsh-webview') }
}

import { expect, it, vi } from 'vitest'
import type { Session } from 'electron'
import { installIdeWebviews } from '../src/ide-webview.ts'

it.each(['local', 'invalid-bootstrap', 'invalid-defaults', 'invalid-extension-kinds'] as const)('webview bootstrap: %s', async (mode) => {
  const handlers = new Map<string, (request: Request) => Promise<Response>>()
  const configuration = {
    remoteAuthority: '127.0.0.1:1234', enableWorkspaceTrust: true,
    configurationDefaults: mode === 'invalid-defaults' ? [] : {
      'editor.fontSize': 17,
      'remote.extensionKind': mode === 'invalid-extension-kinds' ? null : {
        'vscode.typescript-language-features': ['web'], 'example.unchanged': ['ui'],
      },
    },
  }
  const html = `<meta id="vscode-workbench-web-configuration" data-settings="${JSON.stringify(configuration).replaceAll('"', '&quot;')}"><script src="/stable-test/static/out/vs/code/browser/workbench/workbench.js"></script>`
  const upstream = vi.fn(async (request: Request | string) => new URL(typeof request === 'string' ? request : request.url).pathname === '/'
    ? new Response(mode === 'invalid-bootstrap' ? '<html>Unavailable</html>' : html, { headers: { 'content-type': 'text/html', 'content-security-policy': "default-src 'self'; frame-src https:" } })
    : new Response('upstream asset'))
  const browser = {
    fetch: upstream,
    protocol: {
      handle: (scheme: string, handler: (request: Request) => Promise<Response>) => { handlers.set(scheme, handler) },
      unhandle: (scheme: string) => { handlers.delete(scheme) },
    },
  } as unknown as Session
  const dispose = installIdeWebviews(browser, 'http://127.0.0.1:1234/?tkn=private')
  try {
    const request = handlers.get('http')?.(new Request('http://127.0.0.1:1234/'))
    if (mode === 'invalid-bootstrap') {
      await expect(request).rejects.toThrow('expected workbench bootstrap configuration')
    } else if (mode === 'invalid-defaults') {
      await expect(request).rejects.toThrow('invalid default configuration')
    } else if (mode === 'invalid-extension-kinds') {
      await expect(request).rejects.toThrow('invalid extension kinds')
    } else {
      const response = await request
      expect(await response?.text()).toMatchInlineSnapshot('"<meta id="vscode-workbench-web-configuration" data-settings="{&quot;remoteAuthority&quot;:&quot;127.0.0.1:1234&quot;,&quot;enableWorkspaceTrust&quot;:true,&quot;configurationDefaults&quot;:{&quot;editor.fontSize&quot;:17,&quot;remote.extensionKind&quot;:{&quot;vscode.typescript-language-features&quot;:[&quot;workspace&quot;,&quot;-web&quot;],&quot;example.unchanged&quot;:[&quot;ui&quot;]}},&quot;webviewEndpoint&quot;:&quot;rsh-webview://{{uuid}}/&quot;}"><script src="/stable-test/static/out/vs/code/browser/workbench/workbench.js"></script>"')
      expect(response?.headers.get('content-security-policy')).toContain('frame-src rsh-webview: https:')
      expect(await handlers.get('rsh-webview')?.(new Request('rsh-webview://isolated/index.html?id=panel')).then(value => value.text())).toBe('upstream asset')
      expect(upstream).toHaveBeenLastCalledWith('http://127.0.0.1:1234/stable-test/static/out/vs/workbench/contrib/webview/browser/pre/index.html?id=panel', { bypassCustomProtocolHandlers: true })
      expect((await handlers.get('rsh-webview')?.(new Request('rsh-webview://isolated/private.txt')))?.status).toBe(404)
    }
  } finally { dispose() }
  expect(handlers.size).toBe(0)
})

/** Desktop-owned Web asset routes for the legacy Client page. */
import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionFetchHandler } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-modules'
import type {} from '@deepseek-ai/dsh-http-routes-cordis'
import { renderIndexInjections, type IndexInjection } from '@deepseek-ai/dsh-http-routes/client'

/** Desktop stream endpoint shared with the injected browser transport. */
export const DESKTOP_STREAM_PATH = '/.dsh/remote-stream'
const HTML_CONTENT_TYPE = 'text/html; charset=utf-8'
const DESKTOP_TRANSPORT_SCRIPT = `globalThis.__DSH_TRANSPORT__={
  ownsHost:true,
  async *openStream(endpoint,payload,signal){
    const response=await fetch(${JSON.stringify(DESKTOP_STREAM_PATH)},{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint,payload}),signal
    })
    if(!response.ok||response.body===null)throw new Error('desktop stream transport failed: HTTP '+response.status)
    const reader=response.body.getReader(),decoder=new TextDecoder()
    let pending=''
    for(;;){
      const {done,value}=await reader.read()
      pending+=decoder.decode(value,{stream:!done})
      let newline
      while((newline=pending.indexOf('\\n'))!==-1){
        const line=pending.slice(0,newline);pending=pending.slice(newline+1)
        if(line!=='')yield JSON.parse(line)
      }
      if(done)break
    }
    if(pending!=='')yield JSON.parse(pending)
  }
}`

const MIME: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
}

/** Serve the installed legacy frontend and its Host-owned transport. */
export function createDesktopAssetHandler(ctx: Context, runtimeDir: string): ConnectionFetchHandler {
  const require = createRequire(join(runtimeDir, 'package.json'))
  const distIndex = require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')
  const distRoot = realpathSync(dirname(distIndex))
  const renderIndex = async (): Promise<Response> => {
    const rows: IndexInjection[] = [{ kind: 'script', placement: 'head', text: DESKTOP_TRANSPORT_SCRIPT }]
    ctx.emit('webserver/index-inject', rows)
    const body = renderIndexInjections(await readFile(distIndex, 'utf8'), rows)
    return new Response(body, { headers: { 'content-type': HTML_CONTENT_TYPE } })
  }
  return {
    requestBodyMode: () => 'buffered',
    async fetch(request): Promise<Response> {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
      const url = new URL(request.url)
      if (url.pathname.startsWith('/.dsh/native-client/')) return new Response(null, { status: 404 })
      if (url.pathname.startsWith('/plugins/')) return ctx.clientModules.fetchBundle(request)
      let pathname: string
      try {
        pathname = decodeURIComponent(url.pathname)
      } catch {
        return new Response(null, { status: 400 })
      }
      if (pathname === '/native.html') return new Response(null, { status: 404 })
      if (pathname === '/' || pathname === '/index.html') return renderIndex()
      const target = resolve(normalize(join(distRoot, pathname)))
      if (target !== distRoot && !target.startsWith(distRoot + sep)) return new Response(null, { status: 403 })
      try {
        const realTarget = realpathSync(target)
        if (realTarget !== distRoot && !realTarget.startsWith(distRoot + sep)) return new Response(null, { status: 403 })
        return new Response(request.method === 'HEAD' ? null : await readFile(realTarget), {
          headers: { 'content-type': MIME[extname(realTarget)] ?? 'application/octet-stream' },
        })
      } catch {
        return renderIndex()
      }
    },
  }
}

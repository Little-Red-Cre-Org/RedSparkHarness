/** Replays the web-fetch snapshot through a deterministic loopback page. */
const PAGE = `<!doctype html>
<html><head><title>Menu</title><style>.x{color:red}</style><script>ignored()</script></head>
<body>
<h1>Caf&eacute; menu</h1>
<p>Prices include <strong>service &amp; <em>tax</em></strong> &mdash; updated daily.</p>
<ul><li>Espresso</li><li>Flat white</li></ul>
<table><thead><tr><th>Drink</th><th>Price</th></tr></thead><tbody><tr><td>Espresso</td><td>&euro;2</td></tr><tr><td>Flat white</td><td>&euro;3</td></tr></tbody></table>
<p>See <a href="https://fixture.invalid/specials">today&rsquo;s specials</a>.</p>
</body></html>
`

import { createServer } from 'node:http'

/** Model-visible URL retained by the recorded Session. */
const RECORDED_URL = 'http://public.test:43117/menu.html'

/** Native plugin name. */
export const plugin = {
  apiVersion: 1, name: 'native-web-fetch-fixture', targets: ['host'],
  requires: ['web'], optional: [], provides: [],
  resolve: () => (context) => {
    const readiness = Promise.withResolvers()
    let port
    const server = createServer((req, res) => {
      if (req.url === '/menu.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(PAGE)
        return
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
    })
    context.own(() => new Promise((resolve) => {
      server.closeAllConnections()
      server.close(() => { resolve() })
    }))
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port
      readiness.resolve()
    })
    const web = context.require('web')
    context.effect(web.registerFetchProvider({
      id: 'native-fixture-fetch',
      available: () => true,
      fetch: async () => {
        await readiness.promise
        const response = await fetch(`http://127.0.0.1:${port}/menu.html`)
        const content = await response.text()
        return { url: RECORDED_URL, statusCode: response.status,
          body: { kind: 'html', content }, truncated: false }
      },
    }))
  },
}

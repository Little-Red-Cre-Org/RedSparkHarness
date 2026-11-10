/** Replays the search endpoint-guidance snapshot through a deterministic failing endpoint. */
import { createServer } from 'node:http'

/** Port the recorded configuration names. */
const RECORDED_PORT = 43118

/** Native plugin name. */
export const plugin = {
  apiVersion: 1, name: 'native-web-search-error-fixture', targets: ['host'],
  requires: [], optional: [], provides: [],
  resolve: () => (context) => {
    const server = createServer((request, response) => {
      if (request.method === 'POST' && request.url === '/anthropic/v1/messages') {
        response.writeHead(401, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'invalid snapshot API key' } }))
        return
      }
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('not found')
    })
    context.own(() => new Promise((resolve) => {
      server.closeAllConnections()
      server.close(() => { resolve() })
    }))
    server.listen(RECORDED_PORT, '127.0.0.1')
  },
}

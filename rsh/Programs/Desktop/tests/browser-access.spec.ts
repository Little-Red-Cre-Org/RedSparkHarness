import { expect, it } from 'vitest'
import { get } from 'node:http'
import { DesktopBrowserAccess } from '../src/browser-access.ts'

it.each(['GET', 'POST'])('shares Host data through authenticated browser %s', async (method) => {
  const state = { title: 'original' }
  const access = new DesktopBrowserAccess(async (request) => {
    expect(new URL(request.url).origin).toBe('null')
    expect(new URL(request.url).host).toBe('app')
    if (request.method === 'POST') state.title = await request.text()
    return Response.json(state)
  })
  try {
    const entry = await access.open()
    const origin = new URL(entry).origin
    expect((await fetch(origin)).status).toBe(403)
    const login = await fetch(entry, { redirect: 'manual' })
    expect(login.status).toBe(303)
    expect(login.headers.get('location')).toBe('/')
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!
    expect((await fetch(origin, { headers: { cookie, origin: 'https://untrusted.example' } })).status).toBe(403)
    const foreignHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      get(origin, { headers: { cookie, host: 'untrusted.example' } }, (response) => {
        response.resume()
        response.once('end', () => { resolve(response.statusCode) })
      }).once('error', reject)
    })
    expect(foreignHostStatus).toBe(403)
    state.title = 'changed in desktop'
    expect(await (await fetch(origin, { headers: { cookie } })).json()).toEqual(state)
    const response = await fetch(origin, { method, headers: { cookie, origin }, ...(method === 'POST' ? { body: 'changed in browser' } : {}) })
    expect(await response.json()).toEqual({ title: method === 'POST' ? 'changed in browser' : 'changed in desktop' })
  } finally { await access.close() }
})

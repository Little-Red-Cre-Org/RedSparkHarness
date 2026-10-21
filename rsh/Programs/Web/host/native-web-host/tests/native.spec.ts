import { expect, it, vi } from 'vitest'
import type { NativeHttpHost } from '@deepseek-ai/dsh-native-web-assets'
import { NativeWebApplication, resolveNativeWebHostConfig } from '../src/native.ts'

it('validates explicit native Web Host configuration', () => {
  expect(() => resolveNativeWebHostConfig(null)).toThrow('configuration must be an object')
  expect(() => resolveNativeWebHostConfig({ projectDir: 'project', runtimeDir: 'runtime', extra: true }))
    .toThrow('unknown configuration field extra')
  expect(() => resolveNativeWebHostConfig({ projectDir: '', runtimeDir: 'runtime' }))
    .toThrow('projectDir must be a nonempty string')
  expect(() => resolveNativeWebHostConfig({ projectDir: 'project', runtimeDir: 'runtime', port: 65536 }))
    .toThrow('port must be an integer in the configured range')
  expect(resolveNativeWebHostConfig({
    projectDir: 'project', runtimeDir: 'runtime', host: '0.0.0.0', port: 0,
    trustedHosts: ['https://example.test'], cookieMaxAgeDays: 14,
  })).toEqual({
    projectDir: 'project', runtimeDir: 'runtime', host: '0.0.0.0', port: 0,
    trustedHosts: ['https://example.test'], cookieMaxAgeDays: 14, clientReload: 'startup',
  })
})

it('accepts live Client reload only as an explicit Host choice', () => {
  expect(resolveNativeWebHostConfig({ projectDir: 'project', runtimeDir: 'runtime', clientReload: 'live' }).clientReload).toBe('live')
  expect(() => resolveNativeWebHostConfig({ projectDir: 'project', runtimeDir: 'runtime', clientReload: 'unexpected' }))
    .toThrow('clientReload must be startup or live')
})

it('prints the authenticated URL and waits for native host cancellation', async () => {
  const host = {
    url: 'http://127.0.0.1:43123/',
    connection: { authenticatedUrl: (url: string) => `${url}?token=test` },
  } as NativeHttpHost
  const application = new NativeWebApplication(host)
  const controller = new AbortController()
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => { return true })
  try {
    const running = application.run([], controller.signal)
    await vi.waitFor(() => { expect(write).toHaveBeenCalledWith('http://127.0.0.1:43123/?token=test\n') })
    controller.abort()
    await expect(running).resolves.toBe(0)
    await expect(application.run(['unexpected'], controller.signal)).rejects.toThrow('task arguments are unsupported')
  } finally {
    write.mockRestore()
  }
})

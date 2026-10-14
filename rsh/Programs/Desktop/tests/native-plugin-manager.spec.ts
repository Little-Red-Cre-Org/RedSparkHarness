import { readFileSync } from 'node:fs'
import { runInContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { DesktopBackendState } from '../src/backend-controller.ts'
import { resolveDesktopLocale } from '../src/locale.ts'

// Fixtures exercise the reviewed facade proposal; the backend's public types are not exported yet.
function inventory(revision = 'revision-1') {
  const details = { packageName: 'example-module', hasConfig: false, availableTargets: ['host', 'client'], nativeApiVersion: 1 }
  return {
    runtime: 'native', revision, scopes: [{ id: 'root' }, { id: 'empty', parent: 'root' }],
    packages: [{
      packageName: 'example-module', packageVersion: '1.0.0', managedBy: 'profile',
      packageCapabilities: { canUpdatePackage: true, canRemovePackage: true },
      installations: [
        { ...details, target: 'host', id: 'shared', scope: 'root', enabled: true, canEnable: false, canDisable: true },
        { ...details, target: 'client', id: 'shared', enabled: false, disabled: true, hasConfig: true, canEnable: true, canDisable: false },
      ],
    }, {
      packageName: 'runtime-module', packageVersion: '2.0.0', managedBy: 'signed-runtime',
      packageCapabilities: { canUpdatePackage: false, canRemovePackage: false },
      installations: [{ ...details, packageName: 'runtime-module', target: 'host', id: 'essential', scope: 'root',
        enabled: true, canEnable: false, canDisable: false, disableReasons: ['desktop-host-session'] }],
    }],
  }
}

function applied() { return { status: 'applied', revision: 'revision-2', backend: { phase: 'ready' } } }
function failure(code: string, status = 'refused') {
  return { status, error: { code, messageKey: 'backend.key.not.finalized', backend: { phase: 'error', profileRecovery: true } } }
}

function page(locale = 'en', initial: Promise<DesktopBackendState> = Promise.resolve({ phase: 'ready' })) {
  const dom = new JSDOM(readFileSync(new URL('../renderer/plugin-manager.html', import.meta.url), 'utf8'), { runScripts: 'outside-only' })
  onTestFinished(() => { dom.window.dispatchEvent(new dom.window.Event('pagehide')); dom.window.close() })
  const native = {
    list: vi.fn<() => Promise<unknown>>(async () => ({ status: 'listed', inventory: inventory() })),
    install: vi.fn<() => Promise<unknown>>(async () => applied()),
    remove: vi.fn<() => Promise<unknown>>(async () => applied()),
    update: vi.fn<() => Promise<unknown>>(async () => applied()),
    toggle: vi.fn<() => Promise<unknown>>(async () => applied()),
    disableAll: vi.fn<() => Promise<unknown>>(async () => applied()),
  }
  const listeners = new Set<(state: DesktopBackendState) => void>()
  const unsubscribe = vi.fn(() => { listeners.clear() })
  const backend = { status: vi.fn(async () => initial), retry: vi.fn(), subscribe: (listener: (state: DesktopBackendState) => void) => {
    listeners.add(listener)
    return unsubscribe
  } }
  const legacy = { list: vi.fn(async () => [{ name: 'legacy-plugin', version: '1.0.0', enabled: true }]),
    add: vi.fn(), toggle: vi.fn(), remove: vi.fn(), update: vi.fn(), disableAll: vi.fn() }
  Object.defineProperty(dom.window, 'dshDesktop', { value: {
    locale: async () => resolveDesktopLocale(locale), backend, plugins: { ...legacy, native },
  } })
  const element = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const result = dom.window.document.querySelector<T>(selector)
    if (result === null) throw new Error(`Missing module manager element: ${selector}`)
    return result
  }
  const start = () => runInContext(readFileSync(new URL('../renderer/plugin-manager.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
  const settled = async () => { await expect.poll(() => element('main').getAttribute('aria-busy')).toBe('false') }
  const publish = (state: DesktopBackendState) => { for (const listener of listeners) listener(state) }
  return { dom, native, backend, legacy, element, start, settled, publish, unsubscribe }
}

it('groups actual package versions and instances, retains capabilities, and lists empty Host scopes', async () => {
  const p = page('zh-CN')
  p.start()
  await p.settled()
  expect(p.legacy.list).not.toHaveBeenCalled()
  expect(p.element('#plugins').textContent).toMatchInlineSnapshot('"example-module1.0.0 · Profile 管理的包更新移除Host · shared · root已启用 · 无配置禁用Client · shared已禁用 · 已提供配置启用runtime-module2.0.0 · 签名运行时包更新移除Host · essential · root已启用 · 无配置 · 必需的 Desktop Host 会话禁用"')
  expect([...p.dom.window.document.querySelectorAll<HTMLOptionElement>('[data-field="scope"] option')].map(option => option.value)).toEqual(['root', 'empty'])
  const immutable = p.dom.window.document.querySelectorAll<HTMLButtonElement>('.native-package:nth-child(2) button')
  expect([...immutable].every(button => button.disabled)).toBe(true)
  expect(p.element('#retry').hidden).toBe(true)
  p.element<HTMLButtonElement>('[data-target="client"][data-id="shared"] button').click()
  await p.settled()
  expect(p.native.toggle).toHaveBeenCalledWith({ expectedRevision: 'revision-1', key: { target: 'client', id: 'shared' }, enabled: true })
  expect([...p.dom.window.document.querySelectorAll<HTMLButtonElement>('.native-package:nth-child(2) button')].every(button => button.disabled)).toBe(true)
})

it('submits explicit multi-target install intents and distinguishes absent config from JSON null', async () => {
  const p = page()
  p.start()
  await p.settled()
  p.element<HTMLInputElement>('#package-spec').value = 'example-module'
  p.element<HTMLInputElement>('#package-version').value = '1.0.0'
  p.element<HTMLInputElement>('[data-field="id"]').value = 'new-id'
  p.element<HTMLSelectElement>('[data-field="scope"]').value = 'empty'
  p.element<HTMLButtonElement>('#add-installation').click()
  const target = p.element<HTMLSelectElement>('.installation-editor:nth-child(2) [data-field="target"]')
  target.value = 'client'
  target.dispatchEvent(new p.dom.window.Event('change'))
  p.element<HTMLInputElement>('.installation-editor:nth-child(2) [data-field="id"]').value = 'new-id'
  p.element<HTMLTextAreaElement>('.installation-editor:nth-child(2) [data-field="config"]').value = 'null'
  p.element<HTMLInputElement>('.installation-editor:nth-child(2) [data-field="enabled"]').checked = false
  p.element<HTMLFormElement>('#install-form').requestSubmit()
  await p.settled()
  expect(p.native.install).toHaveBeenCalledWith({ expectedRevision: 'revision-1', packageName: 'example-module', version: '1.0.0', installations: [
    { target: 'host', id: 'new-id', scope: 'empty', config: undefined, enabled: true },
    { target: 'client', id: 'new-id', config: null, enabled: false },
  ] })
  expect(p.native.list).toHaveBeenCalledTimes(2)
  expect(p.element('#status').textContent).toContain('Client activation errors')
  expect(p.legacy.add).not.toHaveBeenCalled()
})

it('updates and removes packages and disables eligible installations using the read revision', async () => {
  const p = page()
  p.dom.window.prompt = vi.fn(() => '1.2.3')
  p.start()
  await p.settled()
  p.element<HTMLButtonElement>('.native-package .package-actions button').click()
  await p.settled()
  expect(p.native.update).toHaveBeenCalledWith({ expectedRevision: 'revision-1', packageName: 'example-module', version: '1.2.3' })
  p.element<HTMLButtonElement>('.native-package .package-actions button:nth-child(2)').click()
  await p.settled()
  expect(p.native.remove).toHaveBeenCalledWith({ expectedRevision: 'revision-1', packageName: 'example-module' })
  p.element<HTMLButtonElement>('#disable-all').click()
  await p.settled()
  expect(p.native.disableAll).toHaveBeenCalledWith({ expectedRevision: 'revision-1' })
  expect(p.native.list).toHaveBeenCalledTimes(4)
})

it('re-reads stale inventory and waits for another user submission without optimistic changes', async () => {
  const p = page()
  const pending = Promise.withResolvers<unknown>()
  p.native.toggle.mockImplementationOnce(() => pending.promise)
  p.start()
  await p.settled()
  p.element<HTMLButtonElement>('[data-target="host"][data-id="shared"] button').click()
  expect(p.element('main').getAttribute('aria-busy')).toBe('true')
  expect(p.element('[data-target="host"][data-id="shared"]').textContent).toContain('Enabled')
  p.element<HTMLButtonElement>('[data-target="host"][data-id="shared"] button').click()
  p.native.list.mockResolvedValueOnce({ status: 'listed', inventory: inventory('revision-new') })
  pending.resolve(failure('stale-revision'))
  await p.settled()
  expect(p.native.toggle).toHaveBeenCalledOnce()
  expect(p.element('#status').textContent).toContain('review it before submitting again')
  p.element<HTMLButtonElement>('[data-target="host"][data-id="shared"] button').click()
  await p.settled()
  expect(p.native.toggle).toHaveBeenLastCalledWith({ expectedRevision: 'revision-new', key: { target: 'host', id: 'shared' }, enabled: false })
})

it('falls back only on wrong-profile and preserves legacy writes', async () => {
  const p = page()
  p.native.list.mockResolvedValue(failure('wrong-profile'))
  p.start()
  await p.settled()
  expect(p.element('#plugins').textContent).toContain('legacy-plugin')
  p.element<HTMLButtonElement>('#plugins button').click()
  await p.settled()
  expect(p.legacy.toggle).toHaveBeenCalledWith('legacy-plugin', false)
  expect(p.native.toggle).not.toHaveBeenCalled()
})

it.each(['busy', 'recovery-required', 'ipc'])('keeps %s failures in Native mode without resubmitting or legacy fallback', async (kind) => {
  const p = page()
  p.start()
  await p.settled()
  if (kind === 'ipc') p.native.disableAll.mockRejectedValueOnce(new Error('private transport diagnostic'))
  else p.native.disableAll.mockResolvedValueOnce(failure(kind, kind === 'busy' ? 'refused' : 'recovery-required'))
  p.element<HTMLButtonElement>('#disable-all').click()
  await p.settled()
  expect(p.native.disableAll).toHaveBeenCalledOnce()
  expect(p.legacy.list).not.toHaveBeenCalled()
  expect(p.legacy.disableAll).not.toHaveBeenCalled()
  expect(p.backend.retry).not.toHaveBeenCalled()
  expect(p.element('#status').textContent).not.toContain('private transport diagnostic')
  expect(p.element('#status').textContent).toContain(kind === 'busy' ? 'Refused' : kind === 'ipc' ? 'could not be confirmed' : 'Recovery required')
})

it('keeps Native list failures from falling back and invalidates writes after a failed refresh', async () => {
  const p = page()
  p.native.list.mockResolvedValueOnce(failure('busy'))
  p.start()
  await p.settled()
  expect(p.legacy.list).not.toHaveBeenCalled()
  expect(p.element<HTMLButtonElement>('#install').disabled).toBe(true)
  p.element<HTMLButtonElement>('#refresh').click()
  await p.settled()
  p.native.list.mockRejectedValueOnce(new Error('connection lost'))
  p.element<HTMLButtonElement>('#refresh').click()
  await p.settled()
  expect(p.element<HTMLButtonElement>('[data-target="host"] button').disabled).toBe(true)
  expect(p.element<HTMLButtonElement>('#disable-all').disabled).toBe(true)
  expect(p.legacy.list).not.toHaveBeenCalled()
})

it('requires a new Native read after legacy detection and never leaves old write controls enabled on transport loss', async () => {
  const p = page()
  p.native.list.mockResolvedValueOnce(failure('wrong-profile'))
  p.start()
  await p.settled()
  p.native.list.mockRejectedValueOnce(new Error('transport lost'))
  p.element<HTMLButtonElement>('#refresh').click()
  await p.settled()
  expect(p.legacy.list).toHaveBeenCalledOnce()
  expect(p.element<HTMLButtonElement>('#plugins button').disabled).toBe(true)
  expect(p.element<HTMLButtonElement>('#install').disabled).toBe(true)
  expect(p.element('#status').textContent).toContain('could not be confirmed')
})

it('keeps subscribed state over a late status response and detaches once on pagehide', async () => {
  const initial = Promise.withResolvers<DesktopBackendState>()
  const p = page('en', initial.promise)
  p.start()
  await expect.poll(() => p.backend.status.mock.calls.length).toBe(1)
  p.publish({ phase: 'error', message: '<img src=x>', profileRecovery: true })
  initial.resolve({ phase: 'starting' })
  await p.settled()
  expect(p.element('#backend-state').textContent).toBe('Backend: error')
  expect(p.element('#profile-recovery').hidden).toBe(false)
  expect(p.element('#startup-error').textContent).toBe('<img src=x>')
  expect(p.element('#startup-error').childElementCount).toBe(0)
  const pending = Promise.withResolvers<unknown>()
  p.native.toggle.mockImplementationOnce(() => pending.promise)
  p.element<HTMLButtonElement>('[data-target="host"] button').click()
  const reads = p.native.list.mock.calls.length
  p.dom.window.dispatchEvent(new p.dom.window.Event('pagehide'))
  pending.resolve(applied())
  await pending.promise
  p.dom.window.dispatchEvent(new p.dom.window.Event('pagehide'))
  expect(p.unsubscribe).toHaveBeenCalledOnce()
  expect(p.native.list).toHaveBeenCalledTimes(reads)
  p.publish({ phase: 'ready' })
  expect(p.element('#backend-state').textContent).toBe('Backend: error')
})

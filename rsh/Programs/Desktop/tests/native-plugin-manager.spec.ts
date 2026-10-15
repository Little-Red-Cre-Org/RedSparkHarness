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

function disableAllInventory(revision: string, options: {
  optional?: boolean
  disabledIds?: readonly string[]
  blockedIds?: readonly string[]
} = {}) {
  const optional = options.optional !== false
  const disabledIds = new Set(options.disabledIds ?? [])
  const blockedIds = new Set(options.blockedIds ?? [])
  const details = { packageName: 'example-module', hasConfig: false, availableTargets: ['host', 'client'], nativeApiVersion: 1 }
  const row = (id: string, target: 'host' | 'client') => {
    const disabled = disabledIds.has(id)
    const blocked = blockedIds.has(id)
    return {
      ...details, target, id, ...(target === 'host' ? { scope: 'root' } : {}),
      enabled: !disabled, canEnable: disabled, canDisable: !disabled && !blocked,
    }
  }
  return {
    runtime: 'native', revision, scopes: [],
    packages: [{
      packageName: 'example-module', packageVersion: '1.0.0', managedBy: 'profile',
      packageCapabilities: { canUpdatePackage: true, canRemovePackage: true },
      installations: [
        row('layout', 'client'),
        row('session-presentation', 'client'),
        ...(optional ? [row('shared', 'host'), row('optional', 'host')] : []),
      ],
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
  const getLocale = vi.fn(async () => resolveDesktopLocale(locale))
  Object.defineProperty(dom.window, 'dshDesktop', { value: {
    locale: getLocale, backend, plugins: { ...legacy, native },
  } })
  const element = (selector: string): HTMLElement => {
    const result = dom.window.document.querySelector<HTMLElement>(selector)
    if (result === null) throw new Error(`Missing module manager element: ${selector}`)
    return result
  }
  const button = (selector: string) => element(selector) as HTMLButtonElement
  const input = (selector: string) => element(selector) as HTMLInputElement
  const select = (selector: string) => element(selector) as HTMLSelectElement
  const textarea = (selector: string) => element(selector) as HTMLTextAreaElement
  const form = (selector: string) => element(selector) as HTMLFormElement
  const start = (): void => { runInContext(readFileSync(new URL('../renderer/plugin-manager.js', import.meta.url), 'utf8'), dom.getInternalVMContext()) }
  const settled = async () => { await expect.poll(() => element('main').getAttribute('aria-busy')).toBe('false') }
  const publish = (state: DesktopBackendState) => { for (const listener of listeners) listener(state) }
  return { dom, native, backend, legacy, getLocale, element, button, input, select, textarea, form, start, settled, publish, unsubscribe }
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
  p.button('[data-target="client"][data-id="shared"] button').click()
  await p.settled()
  expect(p.native.toggle).toHaveBeenCalledWith({ expectedRevision: 'revision-1', key: { target: 'client', id: 'shared' }, enabled: true })
  expect([...p.dom.window.document.querySelectorAll<HTMLButtonElement>('.native-package:nth-child(2) button')].every(button => button.disabled)).toBe(true)
})

it('submits explicit multi-target install intents and distinguishes absent config from JSON null', async () => {
  const p = page()
  p.start()
  await p.settled()
  p.input('#package-spec').value = 'example-module'
  p.input('#package-version').value = '1.0.0'
  p.input('[data-field="id"]').value = 'new-id'
  p.select('[data-field="scope"]').value = 'empty'
  p.button('#add-installation').click()
  const target = p.select('.installation-editor:nth-child(2) [data-field="target"]')
  target.value = 'client'
  target.dispatchEvent(new p.dom.window.Event('change'))
  p.input('.installation-editor:nth-child(2) [data-field="id"]').value = 'new-id'
  p.textarea('.installation-editor:nth-child(2) [data-field="config"]').value = 'null'
  p.input('.installation-editor:nth-child(2) [data-field="enabled"]').checked = false
  p.form('#install-form').requestSubmit()
  await p.settled()
  expect(p.native.install).toHaveBeenCalledWith({ expectedRevision: 'revision-1', packageName: 'example-module', version: '1.0.0', installations: [
    { target: 'host', id: 'new-id', scope: 'empty', config: undefined, enabled: true },
    { target: 'client', id: 'new-id', config: null, enabled: false },
  ] })
  expect(p.native.list).toHaveBeenCalledTimes(2)
  expect(p.element('#status').textContent).toContain('Client activation errors')
  expect(p.legacy.add).not.toHaveBeenCalled()
})

it('uses inline version input for Native and compatibility package updates', async () => {
  const p = page()
  p.start()
  await p.settled()
  p.button('.native-package .package-actions button').click()
  expect(p.input('.version-editor input').value).toBe('1.0.0')
  p.input('.version-editor input').value = '  '
  p.form('.version-editor').requestSubmit()
  expect(p.native.update).not.toHaveBeenCalled()
  p.input('.version-editor input').value = '1.0.0'
  p.form('.version-editor').requestSubmit()
  expect(p.native.update).not.toHaveBeenCalled()
  p.button('.version-editor button:last-child').click()
  expect(p.dom.window.document.querySelector('.version-editor')).toBeNull()
  p.button('.native-package .package-actions button').click()
  p.input('.version-editor input').value = ' 1.2.3 '
  p.form('.version-editor').requestSubmit()
  await p.settled()
  expect(p.native.update).toHaveBeenCalledWith({ expectedRevision: 'revision-1', packageName: 'example-module', version: '1.2.3' })
  p.button('.native-package .package-actions button:nth-child(2)').click()
  await p.settled()
  expect(p.native.remove).toHaveBeenCalledWith({ expectedRevision: 'revision-1', packageName: 'example-module' })
  p.native.list.mockResolvedValue(failure('wrong-profile'))
  p.button('#refresh').click()
  await p.settled()
  p.button('#plugins button:nth-child(2)').click()
  p.input('.version-editor input').value = ' 1.2.3 '
  p.form('.version-editor').requestSubmit()
  await p.settled()
  expect(p.legacy.update).toHaveBeenCalledWith('legacy-plugin', '1.2.3')
})

it('keeps core Client rows out of Native disable-all and refreshes revision between toggles', async () => {
  const p = page()
  p.native.list.mockResolvedValueOnce({ status: 'listed', inventory: disableAllInventory('revision-1', { optional: false }) })
  p.start()
  await p.settled()
  expect(p.button('#disable-all').disabled).toBe(true)
  expect(p.element('#disable-all-note').textContent).toContain('layout and session-presentation stay enabled')
  p.native.list.mockResolvedValueOnce({ status: 'listed', inventory: disableAllInventory('revision-1') })
    .mockResolvedValueOnce({ status: 'listed', inventory: disableAllInventory('revision-2', { disabledIds: ['shared'] }) })
    .mockResolvedValueOnce({ status: 'listed', inventory: disableAllInventory('revision-3', { disabledIds: ['shared', 'optional'] }) })
  p.button('#refresh').click()
  await p.settled()
  expect(p.button('#disable-all').disabled).toBe(false)
  p.button('#disable-all').click()
  await p.settled()
  expect(p.native.disableAll).not.toHaveBeenCalled()
  expect(p.native.toggle).toHaveBeenNthCalledWith(1, {
    expectedRevision: 'revision-1', key: { target: 'host', id: 'shared' }, enabled: false,
  })
  expect(p.native.toggle).toHaveBeenNthCalledWith(2, {
    expectedRevision: 'revision-2', key: { target: 'host', id: 'optional' }, enabled: false,
  })
  expect(p.native.toggle).toHaveBeenCalledTimes(2)
  expect(p.button('#disable-all').disabled).toBe(true)
  // After disabling a consumer, a previously blocked provider becomes eligible on the next inventory.
  p.native.list.mockResolvedValueOnce({
    status: 'listed', inventory: disableAllInventory('revision-4', { blockedIds: ['optional'] }),
  }).mockResolvedValueOnce({
    status: 'listed', inventory: disableAllInventory('revision-5', { disabledIds: ['shared'] }),
  }).mockResolvedValueOnce({
    status: 'listed', inventory: disableAllInventory('revision-6', { disabledIds: ['shared', 'optional'] }),
  })
  p.button('#refresh').click()
  await p.settled()
  p.button('#disable-all').click()
  await p.settled()
  expect(p.native.toggle).toHaveBeenNthCalledWith(3, {
    expectedRevision: 'revision-4', key: { target: 'host', id: 'shared' }, enabled: false,
  })
  expect(p.native.toggle).toHaveBeenNthCalledWith(4, {
    expectedRevision: 'revision-5', key: { target: 'host', id: 'optional' }, enabled: false,
  })
  expect(p.native.toggle).toHaveBeenCalledTimes(4)
  p.native.list.mockResolvedValueOnce({ status: 'listed', inventory: disableAllInventory('revision-7') })
  p.button('#refresh').click()
  await p.settled()
  p.native.toggle.mockResolvedValueOnce(failure('busy'))
  p.button('#disable-all').click()
  await p.settled()
  expect(p.native.toggle).toHaveBeenCalledTimes(5)
})

it('re-reads stale inventory and waits for another user submission without optimistic changes', async () => {
  const p = page()
  const pending = Promise.withResolvers<unknown>()
  p.native.toggle.mockImplementationOnce(() => pending.promise)
  p.start()
  await p.settled()
  p.button('[data-target="host"][data-id="shared"] button').click()
  expect(p.element('main').getAttribute('aria-busy')).toBe('true')
  expect(p.element('[data-target="host"][data-id="shared"]').textContent).toContain('Enabled')
  p.button('[data-target="host"][data-id="shared"] button').click()
  p.native.list.mockResolvedValueOnce({ status: 'listed', inventory: inventory('revision-new') })
  pending.resolve(failure('stale-revision'))
  await p.settled()
  expect(p.native.toggle).toHaveBeenCalledOnce()
  expect(p.element('#status').textContent).toContain('review it before submitting again')
  p.button('[data-target="host"][data-id="shared"] button').click()
  await p.settled()
  expect(p.native.toggle).toHaveBeenLastCalledWith({ expectedRevision: 'revision-new', key: { target: 'host', id: 'shared' }, enabled: false })
})

it('falls back only on wrong-profile and preserves legacy writes', async () => {
  const p = page()
  p.native.list.mockResolvedValue(failure('wrong-profile'))
  p.start()
  await p.settled()
  expect(p.element('#plugins').textContent).toContain('legacy-plugin')
  p.button('#plugins button').click()
  await p.settled()
  expect(p.legacy.toggle).toHaveBeenCalledWith('legacy-plugin', false)
  expect(p.native.toggle).not.toHaveBeenCalled()
})

it.each(['recovery-required', 'ipc'])('keeps %s failures in Native mode without resubmitting or legacy fallback', async (kind) => {
  const p = page()
  p.start()
  await p.settled()
  if (kind === 'ipc') p.native.toggle.mockRejectedValueOnce(new Error('private transport diagnostic'))
  else p.native.toggle.mockResolvedValueOnce(failure(kind, 'recovery-required'))
  p.button('#disable-all').click()
  await p.settled()
  expect(p.native.toggle).toHaveBeenCalledOnce()
  expect(p.native.disableAll).not.toHaveBeenCalled()
  expect(p.legacy.list).not.toHaveBeenCalled()
  expect(p.legacy.disableAll).not.toHaveBeenCalled()
  expect(p.backend.retry).not.toHaveBeenCalled()
  expect(p.element('#status').textContent).not.toContain('private transport diagnostic')
  expect(p.element('#status').textContent).toContain(kind === 'ipc' ? 'could not be confirmed' : 'Recovery required')
})

it('keeps Native list failures from falling back and invalidates writes after a failed refresh', async () => {
  const p = page()
  p.native.list.mockResolvedValueOnce(failure('busy'))
  p.start()
  await p.settled()
  expect(p.legacy.list).not.toHaveBeenCalled()
  expect(p.button('#install').disabled).toBe(true)
  p.button('#refresh').click()
  await p.settled()
  p.native.list.mockRejectedValueOnce(new Error('connection lost'))
  p.button('#refresh').click()
  await p.settled()
  expect(p.button('[data-target="host"] button').disabled).toBe(true)
  expect(p.button('#disable-all').disabled).toBe(true)
  expect(p.legacy.list).not.toHaveBeenCalled()
})

it('requires a new Native read after legacy detection and never leaves old write controls enabled on transport loss', async () => {
  const p = page()
  p.native.list.mockResolvedValueOnce(failure('wrong-profile'))
  p.start()
  await p.settled()
  p.native.list.mockRejectedValueOnce(new Error('transport lost'))
  p.button('#refresh').click()
  await p.settled()
  expect(p.legacy.list).toHaveBeenCalledOnce()
  expect(p.button('#plugins button').disabled).toBe(true)
  expect(p.button('#install').disabled).toBe(true)
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
  expect(p.element('#startup-error').textContent).toBe('Backend: error')
  expect(p.element('#startup-error').childElementCount).toBe(0)
  const pending = Promise.withResolvers<unknown>()
  p.native.toggle.mockImplementationOnce(() => pending.promise)
  p.button('[data-target="host"] button').click()
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

it('does not subscribe or read inventory when locale arrives after pagehide', async () => {
  const p = page()
  const locale = Promise.withResolvers<ReturnType<typeof resolveDesktopLocale>>()
  p.getLocale.mockImplementationOnce(() => locale.promise)
  p.start()
  p.dom.window.dispatchEvent(new p.dom.window.Event('pagehide'))
  locale.resolve(resolveDesktopLocale('en'))
  await locale.promise
  expect(p.native.list).not.toHaveBeenCalled()
  expect(p.backend.status).not.toHaveBeenCalled()
  expect(p.unsubscribe).not.toHaveBeenCalled()
  expect(p.element('#title').textContent).toBe('')
})

it('keeps raw backend diagnostics out of Native initial status and subscriptions', async () => {
  const diagnostic = 'config apiKey=SECRET; /private/profile/rsh.client.json; pnpm stderr: private output'
  const p = page('en', Promise.resolve({ phase: 'error', profileRecovery: true, message: diagnostic }))
  p.start()
  await p.settled()
  const expectSafe = () => {
    expect(p.element('#startup-error').textContent).toBe('Backend: error')
    for (const fragment of ['apiKey=SECRET', '/private/profile/', 'pnpm stderr', 'private output']) {
      expect(p.dom.window.document.body.textContent).not.toContain(fragment)
    }
    expect(p.element('#backend-state').textContent).toBe('Backend: error')
  }
  expectSafe()
  p.publish({ phase: 'error', profileRecovery: false, message: diagnostic })
  expectSafe()
  expect(p.element('#profile-recovery').hidden).toBe(true)
})

it('submits the legacy form after Native inventory switches to wrong-profile', async () => {
  const p = page()
  p.start()
  await p.settled()
  expect(p.form('#install-form').checkValidity()).toBe(false)
  p.native.list.mockResolvedValue(failure('wrong-profile'))
  p.button('#refresh').click()
  await p.settled()
  p.input('#package-spec').value = 'legacy-plugin@1.2.3'
  expect(p.form('#install-form').checkValidity()).toBe(true)
  const expectInactiveFields = () => {
    for (const control of p.dom.window.document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>('#native-install input, #native-install select, #native-install textarea, #native-install button')) {
      expect(control.disabled).toBe(true)
      expect(control.dataset.unavailable).toBe('true')
    }
  }
  expectInactiveFields()
  p.form('#install-form').requestSubmit()
  await p.settled()
  expect(p.legacy.add).toHaveBeenCalledWith('legacy-plugin@1.2.3')
  expect(p.native.install).not.toHaveBeenCalled()
  expectInactiveFields()
})

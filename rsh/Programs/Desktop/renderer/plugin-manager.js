// Native consumers follow the reviewed facade; the backend owns package and composition admission.
const api = window.dshDesktop
// The Host disableAll required closure omits these Client shell registrations.
const coreClientIds = new Set(['layout', 'session-presentation'])

async function main() {
  let closed = false
  let unsubscribe
  window.addEventListener('pagehide', () => { closed = true; unsubscribe?.() }, { once: true })
  const locale = await api.locale()
  if (closed) return
  const messages = locale.messages
  const message = (key, values = {}) => messages[key].replaceAll(/\{([^{}]+)\}/gu, (placeholder, name) => values[name] ?? placeholder)
  document.documentElement.lang = locale.id
  document.querySelector('#page-title').textContent = messages.pluginManagerTitle
  document.querySelector('#title').textContent = messages.pluginManagerTitle
  document.querySelector('#description').textContent = messages.pluginManagerDescription
  document.querySelector('#refresh').textContent = messages.refresh
  document.querySelector('#package-label').textContent = messages.npmPackage
  document.querySelector('#install').textContent = messages.install
  document.querySelector('#installed-heading').textContent = messages.installed
  document.querySelector('#empty').textContent = messages.noPlugins

  document.querySelector('#recovery-description').textContent = messages.recoveryDescription
  document.querySelector('#retry').textContent = messages.retry
  document.querySelector('#disable-all').textContent = messages.disableAll
  document.querySelector('#disable-all-note').textContent = messages.nativeDisableAllKeepsCore

  const list = document.querySelector('#plugins')
  const empty = document.querySelector('#empty')
  const status = document.querySelector('#status')
  const form = document.querySelector('#install-form')
  const input = document.querySelector('#package-spec')
  const refresh = document.querySelector('#refresh')
  const nativeApi = api.plugins.native
  let nativeMode = nativeApi !== undefined
  let inventory
  let busy = false
  let backendChanges = 0
  let backendReads = 0
  const disableAll = document.querySelector('#disable-all')
  const disableAllNote = document.querySelector('#disable-all-note')
  const retry = document.querySelector('#retry')
  const editors = document.querySelector('#installations')
  const versionInput = document.querySelector('#package-version')
  for (const [selector, key] of [
    ['#version-label', 'nativeExactVersion'], ['#installation-help', 'nativeInstallationHelp'],
    ['#add-installation', 'nativeAddInstallation'],
  ]) document.querySelector(selector).textContent = messages[key]

  function available(control, allowed) {
    control.dataset.unavailable = String(!allowed)
    control.disabled = busy || !allowed
  }

  function configureMode() {
    document.querySelector('#native-install').hidden = !nativeMode
    document.querySelector('#description').textContent = nativeMode ? messages.nativeManagerDescription : messages.pluginManagerDescription
    input.placeholder = nativeMode ? messages.nativePackagePlaceholder : '@scope/plugin@1.2.3'
    versionInput.required = nativeMode
    retry.hidden = nativeMode
    disableAll.textContent = nativeMode ? messages.nativeDisableAll : messages.disableAll
    disableAll.hidden = !nativeMode && document.querySelector('#recovery').hidden
    disableAllNote.hidden = !nativeMode
    if (nativeMode) {
      document.querySelector('#startup-error').textContent = ''
      for (const control of form.querySelectorAll('button, input, select, textarea')) available(control, inventory !== undefined)
      available(disableAll, inventory !== undefined && inventory.packages.some(pkg => pkg.installations.some(
        row => row.canDisable && !(row.target === 'client' && coreClientIds.has(row.id)),
      )))
      if (inventory === undefined) for (const control of list.querySelectorAll('button')) available(control, false)
      updateEditorRemoval()
    } else {
      for (const control of form.querySelectorAll('button, input, select, textarea')) available(control, control.closest('#native-install') === null)
      available(disableAll, true)
      available(retry, true)
    }
  }

  function renderBackend(backend) {
    document.querySelector('#backend-state').textContent = messages[{
      starting: 'nativeBackendStarting', ready: 'nativeBackendReady', error: 'nativeBackendError',
    }[backend.phase]]
    document.querySelector('#profile-recovery').hidden = !backend.profileRecovery
    document.querySelector('#profile-recovery').textContent = messages.nativeProfileRecovery
    document.querySelector('#recovery').hidden = backend.phase !== 'error'
    document.querySelector('#recovery-description').textContent = nativeMode ? messages.nativeRecoveryAdvice : messages.recoveryDescription
    configureMode()
    // Native status uses only localized state; legacy diagnostics retain their existing presentation.
    document.querySelector('#startup-error').textContent = backend.phase === 'error'
      ? (nativeMode ? messages.nativeBackendError : (backend.message ?? '')) : ''
  }

  unsubscribe = api.backend.subscribe(backend => {
    if (closed) return
    backendChanges += 1
    renderBackend(backend)
  })

  // A query issued before a subscription event cannot replace that newer state.
  async function readBackend() {
    const observed = backendChanges
    const read = ++backendReads
    const backend = await api.backend.status()
    if (!closed && observed === backendChanges && read === backendReads) renderBackend(backend)
  }

  function targetLabel(target) {
    return target === 'host' ? messages.nativeHost : messages.nativeClient
  }

  function versionEditor(name, currentVersion, submit, parent) {
    return () => {
      const editor = document.createElement('form')
      editor.className = 'version-editor'
      const version = document.createElement('input')
      version.value = currentVersion
      version.setAttribute('aria-label', message('targetVersion', { name }))
      const apply = document.createElement('button')
      apply.type = 'submit'
      apply.textContent = messages.apply
      const cancel = document.createElement('button')
      cancel.type = 'button'
      cancel.textContent = messages.cancel
      cancel.addEventListener('click', () => { version.value = ''; editor.remove() })
      editor.addEventListener('submit', event => {
        event.preventDefault()
        const nextVersion = version.value.trim()
        if (nextVersion === '' || nextVersion === currentVersion) return
        submit(nextVersion)
      })
      editor.append(version, apply, cancel)
      parent.append(editor)
      version.focus()
    }
  }

  function addInstallation() {
    const editor = document.createElement('div')
    editor.className = 'installation-editor'
    function field(key, control, name) {
      const label = document.createElement('label')
      label.append(document.createTextNode(messages[key]), control)
      control.dataset.field = name
      editor.append(label)
      return control
    }
    const target = field('nativeTarget', document.createElement('select'), 'target')
    for (const value of ['host', 'client']) target.add(new Option(targetLabel(value), value))
    const id = field('nativeId', document.createElement('input'), 'id')
    id.required = true
    const scope = field('nativeScope', document.createElement('select'), 'scope')
    for (const saved of inventory.scopes) scope.add(new Option(saved.id, saved.id))
    scope.required = true
    target.addEventListener('change', () => { scope.parentElement.hidden = target.value !== 'host'; scope.required = target.value === 'host' })
    const config = field('nativeConfig', document.createElement('textarea'), 'config')
    config.rows = 2
    const enabled = field('nativeEnabled', document.createElement('input'), 'enabled')
    enabled.type = 'checkbox'
    enabled.checked = true
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.textContent = messages.nativeRemoveInstallation
    remove.addEventListener('click', () => { editor.remove(); updateEditorRemoval() })
    editor.append(remove)
    editors.append(editor)
    updateEditorRemoval()
  }

  function updateEditorRemoval() {
    for (const control of editors.querySelectorAll('button')) available(control, inventory !== undefined && editors.children.length > 1)
  }

  function renderNative(next) {
    inventory = next
    configureMode()
    for (const scope of editors.querySelectorAll('[data-field="scope"]')) {
      const selected = scope.value
      scope.replaceChildren(...inventory.scopes.map(saved => new Option(saved.id, saved.id)))
      if (inventory.scopes.some(saved => saved.id === selected)) scope.value = selected
    }
    if (editors.children.length === 0) addInstallation()
    updateEditorRemoval()
    const retentionKeys = {
      'desktop-host-session': 'nativeRetentionSession', 'desktop-private-carrier-provider': 'nativeRetentionCarrier',
      'client-boot-requirement': 'nativeRetentionClient', 'required-provider': 'nativeRetentionProvider',
    }
    list.replaceChildren(...inventory.packages.map(pkg => {
      const item = document.createElement('li')
      item.className = 'native-package'
      const heading = document.createElement('div')
      heading.className = 'package-heading'
      const identity = document.createElement('span')
      identity.textContent = pkg.packageName
      const version = document.createElement('span')
      version.className = 'package-version'
      version.textContent = `${pkg.packageVersion} · ${pkg.managedBy === 'profile' ? messages.nativeProfilePackage : messages.nativeSignedPackage}`
      identity.append(version)
      const actions = document.createElement('div')
      actions.className = 'package-actions'
      function action(key, allowed, handler, parent = actions) {
        const control = document.createElement('button')
        control.type = 'button'
        control.textContent = messages[key]
        available(control, allowed)
        control.addEventListener('click', handler)
        parent.append(control)
      }
      action('update', pkg.packageCapabilities.canUpdatePackage, versionEditor(pkg.packageName, pkg.packageVersion, version => void run(
        () => nativeApi.update({ expectedRevision: inventory.revision, packageName: pkg.packageName, version }), message('updating', { name: pkg.packageName }),
      ), actions))
      action('remove', pkg.packageCapabilities.canRemovePackage, () => void run(
        () => nativeApi.remove({ expectedRevision: inventory.revision, packageName: pkg.packageName }), message('removing', { name: pkg.packageName }),
      ))
      heading.append(identity, actions)
      item.append(heading)
      for (const row of pkg.installations) {
        const installation = document.createElement('div')
        installation.className = 'installation'
        installation.dataset.target = row.target
        installation.dataset.id = row.id
        const details = document.createElement('span')
        details.textContent = `${targetLabel(row.target)} · ${row.id}${row.target === 'host' ? ` · ${row.scope}` : ''}`
        const state = document.createElement('span')
        state.className = 'installation-details'
        state.textContent = [row.enabled ? messages.nativeEnabled : messages.disabled,
          row.hasConfig ? messages.nativeConfigPresent : messages.nativeConfigAbsent,
          ...(row.disableReasons ?? []).map(reason => messages[retentionKeys[reason]]),
        ].join(' · ')
        details.append(state)
        installation.append(details)
        action(row.enabled ? 'disable' : 'enable', row.enabled ? row.canDisable : row.canEnable, () => void run(
          () => nativeApi.toggle({ expectedRevision: inventory.revision, key: { target: row.target, id: row.id }, enabled: !row.enabled }), messages.changingActivation,
        ), installation)
        item.append(installation)
      }
      return item
    }))
    empty.hidden = inventory.packages.length !== 0
  }

  function nativeOutcome(outcome) {
    if (outcome.status === 'applied') return messages.nativeApplied
    const errorKeys = {
      'wrong-profile': 'nativeWrongProfile', 'invalid-request': 'nativeInvalidRequest', 'stale-revision': 'nativeStaleRevision',
      'unsupported-module': 'nativeUnsupportedModule', 'package-immutable': 'nativePackageImmutable', 'not-found': 'nativeNotFound',
      'dependency-conflict': 'nativeDependencyConflict', busy: 'nativeBusy', 'host-stop-failed': 'nativeHostStopFailed',
      'package-operation-failed': 'nativePackageOperationFailed', 'profile-invalid': 'nativeProfileInvalid',
      'host-start-failed': 'nativeHostStartFailed', 'recovery-required': 'nativeRecoveryError',
    }
    const error = outcome.error
    const reason = Object.hasOwn(messages, error.messageKey) ? messages[error.messageKey] : messages[errorKeys[error.code]]
    const blocked = (error.blockedBy ?? []).map(key => `${targetLabel(key.target)} · ${key.id}`).join(', ')
    const result = message(outcome.status === 'refused' ? 'nativeRefused' : 'nativeRecoveryRequired', { reason })
      + (blocked ? ` (${blocked})` : '')
    return [result,
      error.diagnostic === undefined ? undefined : message('nativeValidationDiagnostic', error.diagnostic),
    ].filter(value => value !== undefined).join('\n')
  }

  async function nativeInstall() {
    const installations = [...editors.children].map(editor => {
      const value = name => editor.querySelector(`[data-field="${name}"]`)
      const target = value('target').value
      const raw = value('config').value.trim()
      return { target, id: value('id').value.trim(), ...(target === 'host' ? { scope: value('scope').value } : {}),
        config: raw === '' ? undefined : JSON.parse(raw), enabled: value('enabled').checked }
    })
    return nativeApi.install({ expectedRevision: inventory.revision, packageName: input.value.trim(), version: versionInput.value.trim(), installations })
  }

  document.querySelector('#add-installation').addEventListener('click', addInstallation)
  configureMode()

  function setBusy(next, statusMessage = '') {
    busy = next
    for (const control of document.querySelectorAll('button, input, select, textarea')) control.disabled = busy || control.dataset.unavailable === 'true'
    document.querySelector('main').setAttribute('aria-busy', String(busy))
    status.textContent = statusMessage
  }

  async function render() {
    if (nativeApi !== undefined) {
      nativeMode = true
      inventory = undefined
      configureMode()
      const observed = backendChanges
      const outcome = await nativeApi.list()
      if (closed) return
      if (outcome.status === 'listed') { renderNative(outcome.inventory); return }
      if (observed === backendChanges) renderBackend(outcome.error.backend)
      if (outcome.error.code !== 'wrong-profile') {
        inventory = undefined
        configureMode()
        status.textContent = nativeOutcome(outcome)
        return false
      }
      nativeMode = false
      configureMode()
    }
    await readBackend()
    if (closed) return
    const plugins = await api.plugins.list()
    if (closed) return
    list.replaceChildren(...plugins.map(plugin => {
      const item = document.createElement('li')
      const identity = document.createElement('span')
      const version = document.createElement('span')
      version.className = 'package-version'
      version.textContent = plugin.enabled ? plugin.version : `${plugin.version} · ${messages.disabled}`
      identity.append(document.createTextNode(plugin.name), version)
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.textContent = messages.remove
      remove.addEventListener('click', () => void run(
        () => api.plugins.remove(plugin.name),
        message('removing', { name: plugin.name }),
      ))
      const actions = document.createElement('div')
      actions.className = 'package-actions'
      const update = document.createElement('button')
      update.type = 'button'
      update.textContent = messages.update
      update.addEventListener('click', versionEditor(plugin.name, plugin.version, next => void run(
        () => api.plugins.update(plugin.name, next), message('updating', { name: plugin.name }),
      ), actions))
      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.textContent = plugin.enabled ? messages.disable : messages.enable
      toggle.addEventListener('click', () => void run(
        () => api.plugins.toggle(plugin.name, !plugin.enabled), messages.changingActivation,
      ))
      actions.append(toggle, update, remove)
      item.append(identity, actions)
      return item
    }))
    empty.hidden = plugins.length !== 0
  }

  async function run(operation, statusMessage) {
    if (busy || closed) return false
    setBusy(true, statusMessage)
    const observed = backendChanges
    try {
      const outcome = await operation()
      if (closed) return false
      if (!nativeMode) {
        await render()
        if (!closed) status.textContent = messages.operationComplete
        return !closed
      }
      if (observed === backendChanges) renderBackend(outcome.status === 'applied' ? outcome.backend : outcome.error.backend)
      let resultMessage = nativeOutcome(outcome)
      if (outcome.status === 'applied' || outcome.status === 'recovery-required' || outcome.error.code === 'stale-revision') {
        inventory = undefined
        configureMode()
        const rendered = await render()
        if (rendered === false) resultMessage += `\n${status.textContent}`
      }
      await readBackend()
      if (!closed) status.textContent = resultMessage
      return outcome.status === 'applied' && !closed && inventory !== undefined
    } catch (error) {
      if (closed) return false
      if (nativeMode) {
        inventory = undefined
        configureMode()
        try { await render() } catch { /* A failed refresh leaves Native writes unavailable. */ }
        try { await readBackend() } catch { /* Transport loss also prevents a fresh backend read. */ }
        if (!closed) status.textContent = messages.nativeIpcUncertain
      } else status.textContent = error instanceof Error ? error.message : String(error)
      return false
    } finally {
      if (!closed) setBusy(false, status.textContent)
    }
  }

  async function load(statusMessage, success) {
    if (busy || closed) return
    setBusy(true, statusMessage)
    try {
      const rendered = await render()
      await readBackend()
      if (!closed && rendered !== false) status.textContent = success
    } catch (error) {
      if (!closed) {
        if (nativeMode) { inventory = undefined; configureMode() }
        status.textContent = nativeMode ? messages.nativeIpcUncertain : (error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (!closed) setBusy(false, status.textContent)
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const spec = input.value.trim()
    if (spec === '') return
    if (nativeMode) {
      // Validate only the user-entered JSON; package and composition admission belongs to the backend.
      for (const config of editors.querySelectorAll('[data-field="config"]')) {
        if (config.value.trim() === '') continue
        try { JSON.parse(config.value) } catch { status.textContent = messages.nativeInvalidConfig; return }
      }
      void run(nativeInstall, message('installing', { spec }))
      return
    }
    void run(async () => {
      await api.plugins.add(spec)
      input.value = ''
    }, message('installing', { spec }))
  })
  document.querySelector('#retry').addEventListener('click', () => void run(() => api.backend.retry(), messages.retry))
  async function disableNativeEligible() {
    while (inventory !== undefined) {
      const row = inventory.packages.flatMap(pkg => pkg.installations).find(
        candidate => candidate.canDisable && !(candidate.target === 'client' && coreClientIds.has(candidate.id)),
      )
      if (row === undefined) return
      const applied = await run(
        () => nativeApi.toggle({
          expectedRevision: inventory.revision, key: { target: row.target, id: row.id }, enabled: false,
        }),
        messages.changingActivation,
      )
      if (!applied) return
    }
  }

  disableAll.addEventListener('click', () => {
    if (nativeMode) void disableNativeEligible()
    else void run(() => api.plugins.disableAll(), messages.changingActivation)
  })
  refresh.addEventListener('click', () => void load(messages.refreshing, messages.refreshed))

  await load(messages.loadingPlugins, '')
}

void main()

/** Local cold-start animation and Host recovery; no replay is exposed to the application. */
const api = window.dshDesktop

async function main() {
  const { id, messages } = await api.locale()
  document.documentElement.lang = id
  document.querySelector('#page-title').textContent = messages.startupLoading
  document.querySelector('#restart').textContent = messages.restartApplication
  document.querySelector('#disable-plugins').textContent = messages.disableThirdPartyPlugins
  document.querySelector('#reset-configuration').textContent = messages.resetConfiguration
  document.querySelector('#reset-advice').textContent = messages.startupConfigurationAdvice
  document.querySelector('#reinstall-advice').textContent = messages.startupReinstallAdvice
  const intro = document.querySelector('#startup-intro')
  const statusPage = document.querySelector('main')
  const skip = document.querySelector('#intro-skip')
  intro.setAttribute('aria-label', messages.introTitle)
  document.querySelector('#intro-wordmark').setAttribute('aria-label', messages.introTitle)
  document.querySelector('#intro-character').alt = messages.introCharacter
  document.querySelector('#intro-quote-first').textContent = messages.introQuoteFirst
  document.querySelector('#intro-quote-second').textContent = messages.introQuoteSecond
  skip.querySelector('span').textContent = messages.introSkip
  skip.setAttribute('aria-label', messages.introSkipLabel)
  let timer
  let disposed = false
  let failed = false
  let finished = false
  function hideIntro() {
    clearTimeout(timer)
    intro.hidden = true
    intro.classList.remove('playing')
    statusPage.inert = false
    if (document.activeElement === skip) document.querySelector('#title').focus()
  }
  async function finishIntro() {
    if (finished || disposed) return
    finished = true
    hideIntro()
    try { await api.finishIntro() }
    catch (error) { render({ phase: 'error', message: error instanceof Error ? error.message : String(error) }) }
  }
  skip.addEventListener('click', () => { void finishIntro() })
  const escape = (event) => {
    if (event.key === 'Escape' && !intro.hidden) { event.preventDefault(); void finishIntro() }
  }
  document.addEventListener('keydown', escape)
  function render(state) {
    failed = state.phase === 'error'
    if (failed) { finished = true; hideIntro() }
    document.querySelector('main').setAttribute('aria-busy', String(!failed))
    document.querySelector('#spinner').hidden = failed
    document.querySelector('#title').textContent = failed ? messages.startupFailed : messages.startupLoading
    document.querySelector('#description').textContent = failed ? messages.startupErrorDescription : messages.startupLoadingDescription
    document.querySelector('#error').hidden = !failed
    document.querySelector('#error').textContent = failed ? state.message : ''
    document.querySelector('#actions').hidden = !failed
    for (const button of document.querySelectorAll('#actions button')) button.disabled = !failed
    for (const selector of ['#disable-plugins', '#reset-configuration', '#reset-advice']) {
      document.querySelector(selector).hidden = !failed || !state.profileRecovery
    }
    document.querySelector('#reinstall-advice').hidden = !failed
  }
  let changed = false
  const unsubscribe = api.backend.subscribe(state => { changed = true; render(state) })
  window.addEventListener('pagehide', () => {
    disposed = true
    hideIntro()
    unsubscribe()
    document.removeEventListener('keydown', escape)
  }, { once: true })
  const initial = await api.backend.status()
  if (!changed) render(initial)
  const claimed = await api.claimIntro()
  if (claimed && !failed && !disposed) {
    intro.hidden = false
    statusPage.inert = true
    // A failed decorative asset must leave startup and recovery usable.
    void Promise.all([...intro.querySelectorAll('img')].map(image => image.decode())).then(() => {
      if (finished || disposed) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { void finishIntro(); return }
      intro.classList.add('playing')
      timer = setTimeout(() => { void finishIntro() }, 5500)
    }).catch(() => { void finishIntro() })
  }
  async function recover(operation) {
    render({ phase: 'starting' })
    try { await operation() }
    catch (error) {
      const current = await api.backend.status().catch(() => undefined)
      render(current?.phase === 'error' ? current : { phase: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }
  document.querySelector('#disable-plugins').addEventListener('click', () => { void recover(() => api.disablePlugins()) })
  document.querySelector('#reset-configuration').addEventListener('click', () => { void recover(() => api.resetConfiguration()) })
  document.querySelector('#restart').addEventListener('click', () => { void recover(() => api.restart()) })
}

void main()

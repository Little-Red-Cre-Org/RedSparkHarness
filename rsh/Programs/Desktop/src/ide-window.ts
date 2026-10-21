/** Desktop-owned Code OSS window backed by the native IDE profile. */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { watch } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { app, BrowserWindow, WebContentsView, dialog, session, shell, type View } from 'electron'
import { readNativeProfile } from '@deepseek-ai/dsh/native-profile'
import type { DesktopMessages } from './locale.ts'
import { packageIdeExtension } from './ide-extension-package.ts'
import { installIdeWebviews } from './ide-webview.ts'
import { loadIdeLanguage } from './ide-language.ts'
import { parseIdeHandoff, type IdeHandoff } from './ide-handoff.ts'

/** One IDE window and its native profile process; settings survive window closure. */
export class DesktopIdeWindow {
  private view: WebContentsView | undefined
  private host: BrowserWindow | undefined
  private chatView: View | undefined
  private detachLayout: (() => void) | undefined
  private child: ChildProcess | undefined
  private opening: Promise<void> | undefined
  private preparing: Promise<void> | undefined
  private exited: Promise<void> | undefined
  private closing: Promise<void> | undefined
  private checkingClose: Promise<boolean> | undefined
  private editorState: string | undefined
  private stopRequested = false
  private handoff: IdeHandoff | undefined
  private returning: Promise<void> | undefined
  private detachProtocol: (() => void) | undefined

  /**
   * @param node - upstream Node executable used by the desktop host.
   * @param cliDirectory - installed dsh package directory.
   * @param home - shared Harness home containing the native IDE profile.
   * @param messages - desktop-owned localized labels.
   * @param restoreConversation - apply the IDE draft to the retained primary renderer before revealing it.
   * @param fetchApplication - existing Desktop Host request carrier; never starts a second Agent authority.
   */
  constructor(
    private readonly node: string,
    private readonly cliDirectory: string,
    private readonly home: string,
    private readonly messages: DesktopMessages,
    private readonly fetchApplication: (request: Request) => Promise<Response>,
    private readonly restoreConversation: (value: IdeHandoff) => Promise<void>,
  ) {}

  /**
   * Open a selected local workspace, or use the directory chooser for the application menu.
   * @param host - existing application window.
   * @param target - Host-projected workspace and optional plain-text conversation draft.
   * @returns completion of startup; unsaved edits prevent replacing a running IDE.
   */
  open(host: BrowserWindow, target?: IdeHandoff): Promise<void> {
    if (this.opening !== undefined) return this.opening
    this.opening = (async () => {
      await this.returning
      if (this.view !== undefined) {
        if (target === undefined) { this.view.setVisible(true); this.view.webContents.focus(); return }
        this.view.setVisible(true)
        if (!await this.requestClose()) return
      }
      this.stopRequested = false
      await this.start(host, target)
    })().finally(() => { this.opening = undefined })
    return this.opening
  }

  private async start(host: BrowserWindow, target?: IdeHandoff): Promise<void> {
    await this.closing
    const selectedPath = target?.path ?? (await dialog.showOpenDialog({
      title: this.messages.ideChooseWorkspace, properties: ['openDirectory'],
    })).filePaths[0]
    if (this.stopRequested || selectedPath === undefined) return
    const workspacePath = await realpath(selectedPath)
    if (!(await stat(workspacePath)).isDirectory()) throw new Error(this.messages.ideInvalidConfiguration)
    this.handoff = target
    // The CLI resolves its own manifest; bundling its template code changes import.meta.url.
    this.preparing = promisify(execFile)(this.node, [join(this.cliDirectory, 'lib', 'bin.js'), '--profile', 'native-ide', '--dump-config'], {
      cwd: workspacePath, windowsHide: true,
      env: { ...process.env, DSH_HOME: this.home, NODE_OPTIONS: undefined, NODE_PATH: undefined },
    }).then(() => {})
    try { await this.preparing } finally { this.preparing = undefined }
    // A close request can arrive while the CLI prepares the profile.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this.stopRequested) return
    const profile = readNativeProfile({ profile: 'native-ide', patchFiles: [], home: this.home })
    const provider = profile.installations.find(row => row.plugin === '@deepseek-ai/dsh-ide-code-oss' && !row.disabled)
    if (provider === undefined || typeof provider.config !== 'object' || provider.config === null || Array.isArray(provider.config)) {
      throw new Error(this.messages.ideInvalidConfiguration)
    }
    const launchRoot = join(this.home, 'ide', 'launches')
    await mkdir(launchRoot, { recursive: true })
    const launchDirectory = await mkdtemp(join(launchRoot, 'desktop-'))
    const patch = join(launchDirectory, 'workspace.json')
    try {
      const locale = target?.locale ?? app.getLocale()
      const language = locale.toLowerCase().startsWith('zh') ? 'zh-cn' : 'en'
      const builtinExtension = await packageIdeExtension(launchDirectory, locale)
      const editorState = join(launchDirectory, 'editor-state')
      await writeFile(editorState, 'starting', { flag: 'wx' })
      this.editorState = editorState
      const capability = `ide-${randomBytes(24).toString('hex')}`
      const conversation = new URL(`dsh-app://${capability}/index.html`)
      conversation.searchParams.set('desktop', '1')
      conversation.searchParams.set('channel', randomBytes(24).toString('hex'))
      conversation.searchParams.set('workspace', workspacePath)
      conversation.searchParams.set('locale', locale)
      await writeFile(patch, JSON.stringify({ formatVersion: 1, installations: [{
        id: provider.id, config: { ...provider.config, workspaceDirectory: workspacePath, builtinExtension,
          ...(language === 'zh-cn' ? { languagePack: 'MS-CEINTL.vscode-language-pack-zh-hans' } : {}) },
      }] }), { flag: 'wx' })
      // Closing can run while extension packaging and patch writing are awaited.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (this.stopRequested) {
        await rm(launchDirectory, { recursive: true, force: true })
        return
      }
      const child = spawn(this.node, [join(this.cliDirectory, 'lib', 'bin.js'), '--profile', 'native-ide', '--patch', patch], {
        cwd: workspacePath, windowsHide: true,
        env: { ...process.env, DSH_HOME: this.home, NODE_OPTIONS: undefined, NODE_PATH: undefined,
          RSH_WORKBENCH_URL: conversation.href, RSH_WORKBENCH_STATE: editorState },
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      })
      this.child = child
      const ready = Promise.withResolvers<string>()
      let diagnostic = ''
      child.stderr?.on('data', (data: Buffer) => { diagnostic = (diagnostic + data.toString('utf8')).slice(-16384) })
      child.on('error', (error) => { ready.reject(error) })
      child.on('message', (message: unknown) => {
        if (typeof message !== 'object' || message === null || !('type' in message) || message.type !== 'ide-ready'
          || !('protocolVersion' in message) || message.protocolVersion !== 1
          || !('url' in message) || typeof message.url !== 'string') {
          ready.reject(new Error(this.messages.ideInvalidConfiguration))
          return
        }
        const url = URL.parse(message.url)
        if (url === null || url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
          || url.port === '' || url.username !== '' || url.password !== '' || !url.searchParams.has('tkn')) {
          ready.reject(new Error(this.messages.ideInvalidConfiguration))
          return
        }
        ready.resolve(url.href)
      })
      this.exited = new Promise<void>((resolve) => {
        const finished = (): void => {
          child.stderr?.destroy()
          ready.reject(new Error(diagnostic || this.messages.ideServerStopped))
          this.detach()
          resolve()
        }
        child.once('exit', finished)
        child.once('error', finished)
      })
      void this.exited.then(() => rm(launchDirectory, { recursive: true, force: true })).catch((error: unknown) => { console.error(error) })
      const address = await ready.promise
      // The close action can run while the native profile starts.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (this.stopRequested) return
      const origin = new URL(address).origin
      const browserSession = session.fromPartition('persist:rsh-ide')
      const nls = language === 'en' ? undefined : await loadIdeLanguage(provider.config, language)
      const stopWebviews = installIdeWebviews(browserSession, address, nls)
      browserSession.protocol.handle('dsh-app', async (request) => {
        const incoming = new URL(request.url)
        if (incoming.hostname !== capability) return new Response(null, { status: 403 })
        if (incoming.pathname === '/__rsh_desktop/handoff' && request.method === 'GET') {
          const value = this.handoff
          this.handoff = undefined
          return Response.json(value ?? null)
        }
        if (incoming.pathname === '/__rsh_desktop/return' && request.method === 'POST') {
          try {
            const value = parseIdeHandoff(await request.json())
            this.returning ??= this.restoreConversation(value).then(() => {
              this.view?.setVisible(false)
              const { width, height } = host.getContentBounds()
              this.chatView?.setBounds({ x: 0, y: 0, width, height })
              this.chatView?.setVisible(true)
              host.webContents.focus()
            }).finally(() => { this.returning = undefined })
            await this.returning
            return Response.json({ ok: true })
          } catch (error) {
            return Response.json({ message: error instanceof Error ? error.message : String(error) }, { status: 400 })
          }
        }
        incoming.hostname = 'app'
        return this.fetchApplication(new Request(incoming, {
          method: request.method, headers: request.headers, body: request.body,
          signal: request.signal, duplex: 'half',
        } as RequestInit))
      })
      this.detachProtocol = () => { stopWebviews(); browserSession.protocol.unhandle('dsh-app') }
      const view = new WebContentsView({
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'persist:rsh-ide' },
      })
      this.view = view
      this.host = host
      this.chatView = host.contentView.children[0]
      host.contentView.addChildView(view)
      const layout = (): void => {
        const { width, height } = host.getContentBounds()
        view.setBounds({ x: 0, y: process.platform === 'win32' ? 40 : 0,
          width, height: Math.max(0, height - (process.platform === 'win32' ? 40 : 0)) })
      }
      host.on('resize', layout)
      const beforeClose = (event: Electron.Event): void => {
        if (this.view === undefined) return
        event.preventDefault()
        void this.requestClose().then((allowed) => { if (allowed && !host.isDestroyed()) host.close() })
          .catch((error: unknown) => { console.error(error) })
      }
      host.on('close', beforeClose)
      host.once('closed', () => { void this.close().catch((error: unknown) => { console.error(error) }) })
      this.detachLayout = () => { host.removeListener('resize', layout); host.removeListener('close', beforeClose) }
      layout()
      view.webContents.on('will-navigate', (event, url) => {
        if (URL.parse(url)?.origin !== origin) event.preventDefault()
      })
      view.webContents.setWindowOpenHandler(({ url }) => {
        const target = URL.parse(url)
        if (target !== null && ['https:', 'http:'].includes(target.protocol)) {
          void shell.openExternal(target.href).catch((error: unknown) => { console.error(error) })
        }
        return { action: 'deny' }
      })
      await view.webContents.loadURL(address)
      host.show()
      view.webContents.focus()
    } catch (error) {
      await this.close()
      await rm(launchDirectory, { recursive: true, force: true })
      throw error
    }
  }

  private detach(): void {
    this.detachLayout?.()
    this.detachLayout = undefined
    this.detachProtocol?.()
    this.detachProtocol = undefined
    if (this.host !== undefined && !this.host.isDestroyed()) {
      if (this.view !== undefined) this.host.contentView.removeChildView(this.view)
      const { width, height } = this.host.getContentBounds()
      this.chatView?.setBounds({ x: 0, y: 0, width, height })
      this.chatView?.setVisible(true)
    }
    const contents = this.view?.webContents
    if (contents !== undefined && !contents.isDestroyed()) contents.close()
    this.view = undefined
    this.host = undefined
    this.chatView = undefined
    this.editorState = undefined
  }

  /** Check the extension's editor state and upstream unload veto before shutting down the IDE.
   * @returns false when the user keeps the workbench open.
   */
  requestClose(): Promise<boolean> {
    this.checkingClose ??= this.checkClose().finally(() => { this.checkingClose = undefined })
    return this.checkingClose
  }

  private async saveEditors(state: string): Promise<void> {
    const exited = this.exited
    if (exited === undefined) throw new Error(this.messages.ideServerStopped)
    const id = randomBytes(16).toString('hex')
    const saved = Promise.withResolvers<void>()
    const watcher = watch(dirname(state), { persistent: false }, (_event, name) => {
      if (name !== `${basename(state)}.save-result`) return
      void readFile(`${state}.save-result`, 'utf8').then((text) => {
        const result: unknown = JSON.parse(text)
        if (typeof result !== 'object' || result === null || !('id' in result) || result.id !== id
          || !('ok' in result) || typeof result.ok !== 'boolean') throw new Error(this.messages.ideInvalidConfiguration)
        if (result.ok) saved.resolve()
        else saved.reject(new Error(this.messages.ideUnsaved))
      }).catch(saved.reject)
    })
    watcher.on('error', saved.reject)
    try {
      await Promise.all([
        writeFile(`${state}.save-request.tmp`, id).then(() => rename(`${state}.save-request.tmp`, `${state}.save-request`)),
        Promise.race([saved.promise, exited.then(() => { throw new Error(this.messages.ideServerStopped) })]),
      ])
    } finally { watcher.close() }
  }

  private async checkClose(): Promise<boolean> {
    if (this.view !== undefined && this.editorState !== undefined) {
      const state = await readFile(this.editorState, 'utf8')
      if (state === 'dirty' || state === 'clean') {
        try { await this.saveEditors(this.editorState) } catch (error) {
          this.host?.focus()
          dialog.showErrorBox(this.messages.ideWindowTitle, error instanceof Error ? error.message : String(error))
          return false
        }
      } else if (state !== 'starting') {
        this.host?.focus()
        dialog.showErrorBox(this.messages.ideWindowTitle, this.messages.ideInvalidConfiguration)
        return false
      }
    }
    const contents = this.view?.webContents
    if (contents !== undefined && !contents.isDestroyed()) {
      const allowed = await new Promise<boolean>((resolve) => {
        const destroyed = (): void => { contents.removeListener('will-prevent-unload', prevented); resolve(true) }
        const prevented = (): void => {
          contents.removeListener('destroyed', destroyed)
          contents.removeListener('will-prevent-unload', prevented)
          this.host?.focus()
          dialog.showErrorBox(this.messages.ideWindowTitle, this.messages.ideUnsaved)
          resolve(false)
        }
        contents.once('destroyed', destroyed)
        contents.once('will-prevent-unload', prevented)
        contents.close({ waitForBeforeUnload: true })
      })
      if (!allowed) return false
    }
    await this.close()
    return true
  }

  /** Disconnect the private carrier and wait for native disposal of the entire IDE process tree. */
  close(): Promise<void> {
    this.stopRequested = true
    this.closing ??= (async () => {
      await this.preparing?.catch(() => { /* open() reports preparation failure; close still waits for child exit. */ })
      if (this.child?.connected) this.child.disconnect()
      await this.exited
      this.child = undefined
      this.exited = undefined
      this.detach()
    })().finally(() => { this.closing = undefined })
    return this.closing
  }
}

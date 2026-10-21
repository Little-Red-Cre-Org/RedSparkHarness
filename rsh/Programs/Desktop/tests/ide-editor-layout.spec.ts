import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'

const api = vi.hoisted(() => {
  const commands = new Map<string, (...args: any[]) => unknown>() // VS Code commands have heterogeneous arguments.
  const disposable = { dispose() {} }
  const event = vi.fn(() => disposable)
  return {
    commands, disposable, event,
    window: {
      activeTextEditor: undefined,
      tabGroups: { all: [] as { tabs: { isDirty: boolean }[] }[], onDidChangeTabs: event },
      createTreeView: vi.fn(() => ({ ...disposable, title: '' })),
      createStatusBarItem: vi.fn(() => ({ ...disposable, show() {} })),
      registerWebviewViewProvider: vi.fn(() => disposable),
      onDidChangeActiveTextEditor: event,
      showTextDocument: vi.fn(async () => ({})),
      showInformationMessage: vi.fn(async () => undefined),
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: 'C:\\project', path: '/C:/project' } }],
      registerTextDocumentContentProvider: event, onDidCloseTextDocument: event,
      onDidChangeWorkspaceFolders: vi.fn(() => disposable),
      openTextDocument: vi.fn(async () => ({ isUntitled: true })),
    },
  }
})
vi.mock('vscode', () => ({
  languages: { getLanguages: async () => ['javascript', 'plaintext'] },
  window: api.window, workspace: api.workspace, env: { language: 'en' },
  commands: {
    registerCommand: (id: string, action: (...args: any[]) => unknown) => { api.commands.set(id, action); return api.disposable }, // VS Code command callbacks vary by id.
    registerTextEditorCommand: () => api.disposable,
    executeCommand: vi.fn(),
  },
  tasks: { onDidEndTask: api.event },
  EventEmitter: class { event = api.event; fire() {} dispose() {} },
  ViewColumn: { One: 1 }, StatusBarAlignment: { Left: 1, Right: 2 },
  Uri: { file: () => ({ path: '/C:/project' }) },
}))
vi.mock('../src/ide-auto-save.ts', () => ({ installIdeAutoSave: () => async () => {} }))
import { activate } from '../src/ide-extension.ts'
import { installIdeRunner } from '../src/ide-runner.ts'
import { workbenchMessages } from '../src/ide-locale.ts'

it.each(['javascript', 'plaintext'])('does not open Save As when running an untitled %s document', async languageId => {
  const save = vi.fn()
  Object.assign(api.window, { activeTextEditor: { document: { isUntitled: true, languageId, save } } })
  try {
    installIdeRunner({ subscriptions: [] } as unknown as Parameters<typeof installIdeRunner>[0], workbenchMessages('en'))
    await api.commands.get('rsh.runFile')!()
    expect(save).not.toHaveBeenCalled()
  } finally { api.window.activeTextEditor = undefined }
})

it.each([false, true])('keeps code in the editor and conversations in a retained sidebar (restored=%s)', async (restored) => {
  vi.clearAllMocks()
  api.commands.clear()
  api.window.tabGroups.all = [{ tabs: restored ? [{ isDirty: false }] : [] }]
  const directory = mkdtempSync(join(tmpdir(), 'rsh-editor-layout-'))
  vi.stubEnv('RSH_WORKBENCH_URL', 'dsh-app://ide-test/index.html?channel=test')
  vi.stubEnv('RSH_WORKBENCH_STATE', join(directory, 'state'))
  const subscriptions: { dispose(): void }[] = []
  try {
    activate({ subscriptions } as Parameters<typeof activate>[0])
    await Promise.resolve()
    expect(api.workspace.openTextDocument).toHaveBeenCalledTimes(restored ? 0 : 1)
    const registration = api.window.registerWebviewViewProvider.mock.calls[0] as unknown as [string, { resolveWebviewView(view: unknown): void }, unknown]
    expect([registration[0], registration[2]]).toMatchInlineSnapshot(`
      [
        "rsh.conversationView",
        {
          "webviewOptions": {
            "retainContextWhenHidden": true,
          },
        },
      ]
    `)
    const receive = vi.fn()
    const postMessage = vi.fn()
    const view = { webview: { html: '', options: {}, onDidReceiveMessage: receive, postMessage }, onDidDispose: vi.fn(), show: vi.fn() }
    registration[1].resolveWebviewView(view)
    api.commands.get('rsh.newTask')!()
    const onMessage = receive.mock.calls[0]![0]
    onMessage({ type: 'state', channel: 'test', tasks: [], workspace: 'C:\\project', workspaceId: 'project' })
    expect(postMessage).toHaveBeenCalledWith({ type: 'new-session', channel: 'test' })
    api.workspace.onDidChangeWorkspaceFolders.mock.calls[0]![0]()
    expect(receive).toHaveBeenCalledTimes(1)
    await api.commands.get('rsh.newFile')!()
    expect(api.window.showTextDocument).toHaveBeenLastCalledWith({ isUntitled: true }, { viewColumn: 1, preview: false })
    expect(view.show).toHaveBeenCalledWith(true)
  } finally {
    for (const subscription of subscriptions) subscription.dispose()
    vi.unstubAllEnvs()
    rmSync(directory, { recursive: true })
  }
})

it('opens completed answer code in a new central document without replacing an existing editor', async () => {
  vi.clearAllMocks()
  const directory = mkdtempSync(join(tmpdir(), 'rsh-answer-code-'))
  vi.stubEnv('RSH_WORKBENCH_URL', 'dsh-app://ide-test/index.html?channel=test&locale=zh-CN')
  vi.stubEnv('RSH_WORKBENCH_STATE', join(directory, 'state'))
  api.window.tabGroups.all = [{ tabs: [{ isDirty: true }] }]
  const subscriptions: { dispose(): void }[] = []
  try {
    activate({ subscriptions } as Parameters<typeof activate>[0])
    const registration = api.window.registerWebviewViewProvider.mock.calls[0] as unknown as [string, { resolveWebviewView(view: unknown): void }]
    const receive = vi.fn()
    registration[1].resolveWebviewView({ webview: { html: '', options: {}, onDidReceiveMessage: receive, postMessage: vi.fn() }, onDidDispose: vi.fn(), show: vi.fn() })
    const message = receive.mock.calls[0]![0]
    message({ type: 'state', channel: 'test', tasks: [], selected: 'session', workspace: 'C:\\project', workspaceId: 'project' })
    message({ type: 'prepare-code', channel: 'test', sessionId: 'session', requestId: 'first' })
    message({ type: 'answer-code', channel: 'test', sessionId: 'session', blocks: [{ language: 'js', content: 'const answer = 42' }] })
    await vi.waitFor(() => expect(api.workspace.openTextDocument).toHaveBeenCalledWith({ language: 'javascript', content: 'const answer = 42' }))
    expect(api.window.showTextDocument).toHaveBeenCalledWith({ isUntitled: true }, { viewColumn: 1, preview: false, preserveFocus: true })
  } finally {
    for (const subscription of subscriptions) subscription.dispose()
    vi.unstubAllEnvs()
    rmSync(directory, { recursive: true })
  }
})

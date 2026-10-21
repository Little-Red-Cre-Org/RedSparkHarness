import { expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'
import { installIdeCodeActions } from '../src/ide-code-actions.ts'
import { workbenchMessages } from '../src/ide-locale.ts'

const api = vi.hoisted(() => ({
  commands: new Map<string, () => Promise<void>>(),
  show: vi.fn(), execute: vi.fn(), close: vi.fn(), error: vi.fn(),
  tabs: { activeTabGroup: { activeTab: undefined as { input: unknown } | undefined }, all: [] as { tabs: { input: unknown }[] }[] },
}))
vi.mock('vscode', () => {
  class Range {
    constructor(readonly start: number, readonly end: number) {}
    get isEmpty() { return this.start === this.end }
  }
  class Uri {
    constructor(readonly scheme: string, readonly authority: string, readonly path: string, readonly query: string) {}
    static from(value: Uri) { return new Uri(value.scheme, value.authority, value.path, value.query) }
    with(value: { query: string }) { return new Uri(this.scheme, this.authority, this.path, value.query) }
  }
  class TabInputTextDiff { constructor(readonly original: Uri, readonly modified: Uri) {} }
  const disposable = () => ({ dispose() {} })
  return {
    Range, Selection: Range, Uri, TabInputTextDiff, ViewColumn: { One: 1 },
    workspace: { registerTextDocumentContentProvider: disposable },
    window: {
      showTextDocument: api.show, showErrorMessage: api.error,
      tabGroups: { ...api.tabs, close: api.close, onDidChangeTabs: disposable },
    },
    commands: {
      registerCommand: (name: string, callback: () => Promise<void>) => {
        api.commands.set(name, callback)
        return { dispose: () => { api.commands.delete(name) } }
      },
      executeCommand: api.execute,
    },
  }
})

it.each(['insert', 'apply', 'discard', 'changed'] as const)('AI code action: %s', async (mode) => {
  const runtime = await import('vscode')
  const subscriptions: vscode.Disposable[] = []
  let text = 'before'
  let version = 1
  const document = {
    uri: { path: '/sample.ts' }, isClosed: false, get version() { return version },
    getText: () => text, positionAt: (offset: number) => offset, offsetAt: (offset: number) => offset,
  }
  const editor = {
    document, selection: new runtime.Range(0 as unknown as vscode.Position, 0 as unknown as vscode.Position),
    edit: async (build: (edit: { replace: (range: { start: number; end: number }, code: string) => void }) => void) => {
      build({ replace: (range, code) => { text = text.slice(0, range.start) + code + text.slice(range.end); version++ } })
      return true
    },
  }
  api.error.mockClear()
  api.close.mockClear()
  api.execute.mockClear()
  api.show.mockResolvedValue(editor)
  api.execute.mockImplementation(async (command: string, before: vscode.Uri, after: vscode.Uri) => {
    if (command === 'vscode.diff') api.tabs.activeTabGroup.activeTab = { input: new runtime.TabInputTextDiff(before, after) }
  })
  const action = installIdeCodeActions({ subscriptions } as vscode.ExtensionContext, workbenchMessages('en'))
  try {
    await action(mode === 'insert' ? 'insert' : 'preview', 'AI code', 'typescript', editor as unknown as vscode.TextEditor)
    if (mode === 'insert') expect(text).toBe('AI codebefore')
    else {
      expect(text).toBe('before')
      if (mode === 'changed') { text = 'user edit'; version++ }
      await api.commands.get(mode === 'discard' ? 'rsh.discardCode' : 'rsh.applyCode')!()
      expect(text).toBe(mode === 'apply' ? 'AI code' : mode === 'changed' ? 'user edit' : 'before')
      if (mode === 'changed') expect(api.error).toHaveBeenCalledWith(expect.stringContaining('target file changed'))
      if (mode === 'discard') expect(api.execute).toHaveBeenLastCalledWith('workbench.action.closeActiveEditor')
    }
    expect({ text, previewTitle: api.execute.mock.calls.find(call => call[0] === 'vscode.diff')?.[3] as unknown,
      error: api.error.mock.calls[0]?.[0] as unknown }).toMatchSnapshot()
  } finally { for (const subscription of subscriptions.reverse()) subscription.dispose() }
})

/** File execution uses upstream tasks; restricted workspaces never start a process. */
import { expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'
import { installIdeRun } from '../src/ide-run.ts'
import { workbenchMessages } from '../src/ide-locale.ts'

const api = vi.hoisted(() => ({
  commands: new Map<string, () => Promise<unknown>>(), trusted: true,
  save: vi.fn(async () => true), execute: vi.fn(), terminate: vi.fn(), error: vi.fn(),
  ended: undefined as ((event: unknown) => void) | undefined,
}))
vi.mock('vscode', () => ({
  workspace: { get isTrusted() { return api.trusted },
    getWorkspaceFolder: () => ({ uri: { fsPath: 'C:/project with spaces' } }),
    getConfiguration: () => ({ get: () => 'C:/Python/python.exe' }) },
  window: { showErrorMessage: api.error },
  commands: {
    registerCommand: (name: string, action: () => Promise<unknown>) => {
      api.commands.set(name, action); return { dispose() { api.commands.delete(name) } }
    }, executeCommand: vi.fn(async () => {}),
  },
  Task: class {
    readonly args: unknown[]
    constructor(...args: unknown[]) { this.args = args }
  },
  ProcessExecution: class {
    readonly args: unknown[]
    constructor(...args: unknown[]) { this.args = args }
  },
  TaskScope: { Workspace: 2 }, TaskRevealKind: { Always: 1 }, TaskPanelKind: { Dedicated: 2 },
  tasks: { executeTask: api.execute,
    onDidEndTaskProcess: (callback: (event: unknown) => void) => { api.ended = callback; return { dispose() {} } },
    onDidEndTask: () => ({ dispose() {} }),
  },
}))

it.each([true, false])('Run editor file with workspace trusted=%s', async (trusted) => {
  vi.clearAllMocks()
  api.trusted = trusted
  const subscriptions: vscode.Disposable[] = []
  const execution = { terminate: api.terminate }
  api.execute.mockResolvedValue(execution)
  const editor = { document: {
    isClosed: false, isUntitled: false, languageId: 'python', save: api.save,
    uri: { scheme: 'file', fsPath: 'C:/project with spaces/hello.py' },
  } } as unknown as vscode.TextEditor
  const endpoint = process.env.RSH_IDE_EXECUTOR_URL
  delete process.env.RSH_IDE_EXECUTOR_URL
  try {
    installIdeRun({ subscriptions } as vscode.ExtensionContext, workbenchMessages('en'), () => editor)
    await api.commands.get('rsh.runFile')!()
    expect(api.execute).toHaveBeenCalledTimes(trusted ? 1 : 0)
    expect(api.save).toHaveBeenCalledTimes(trusted ? 1 : 0)
    if (trusted) {
      const task = api.execute.mock.calls[0]![0]
      expect(task.args[4].args.slice(0, 2)).toEqual(['C:/Python/python.exe', ['-u', 'C:/project with spaces/hello.py']])
      expect(task.presentationOptions).toEqual({ reveal: 1, focus: true, panel: 2, clear: true })
      await api.commands.get('rsh.stopRun')!()
      expect(api.terminate).toHaveBeenCalledOnce()
      api.ended!({ execution, exitCode: 0 })
      await api.commands.get('rsh.stopRun')!()
      expect(api.terminate).toHaveBeenCalledOnce()
    } else expect(api.error).toHaveBeenCalledWith(expect.stringContaining('Trust this workspace'))
    expect({ trusted, saves: api.save.mock.calls.length, executions: api.execute.mock.calls.length,
      stops: api.terminate.mock.calls.length, errors: api.error.mock.calls.map(call => call[0]) }).toMatchSnapshot()
  } finally {
    for (const subscription of subscriptions.reverse()) subscription.dispose()
    if (endpoint !== undefined) process.env.RSH_IDE_EXECUTOR_URL = endpoint
  }
})

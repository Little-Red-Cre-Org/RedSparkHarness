import { mkdtemp, mkdir, readdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'
import { installIdeProjects } from '../src/ide-projects.ts'
import { workbenchMessages } from '../src/ide-locale.ts'

const api = vi.hoisted(() => ({
  commands: new Map<string, () => Promise<void>>(),
  choose: vi.fn(), name: vi.fn(), error: vi.fn(),
}))
vi.mock('vscode', () => ({
  Uri: { joinPath: (parent: { fsPath: string }, name: string) => ({ fsPath: join(parent.fsPath, name) }) },
  workspace: { workspaceFolders: [] },
  window: { showOpenDialog: api.choose, showInputBox: api.name, showErrorMessage: api.error },
  commands: {
    registerCommand: (id: string, callback: () => Promise<void>) => {
      api.commands.set(id, callback)
      return { dispose() { api.commands.delete(id) } }
    },
    executeCommand: vi.fn(),
  },
}))

it.each(['create', 'cancel', 'existing', 'open'] as const)('Project toolbar: %s', async (mode) => {
  const parent = await mkdtemp(join(tmpdir(), 'rsh-project-toolbar-'))
  const project = join(parent, 'example')
  const subscriptions: vscode.Disposable[] = []
  const switchProject = vi.fn<(folder: vscode.Uri) => Promise<void>>().mockResolvedValue(undefined)
  api.choose.mockResolvedValue([{ fsPath: parent }])
  api.name.mockResolvedValue(mode === 'cancel' ? undefined : 'example')
  api.error.mockClear()
  try {
    if (mode === 'existing') {
      await mkdir(project)
      await writeFile(join(project, 'keep.txt'), 'original')
    }
    installIdeProjects({ subscriptions } as vscode.ExtensionContext, workbenchMessages('en'), switchProject)
    await api.commands.get(mode === 'open' ? 'rsh.openProject' : 'rsh.newProject')!()
    const entries = await readdir(parent)
    expect(entries).toEqual(mode === 'create' || mode === 'existing' ? ['example'] : [])
    if (mode === 'create' || mode === 'open') {
      expect(switchProject).toHaveBeenCalledWith({ fsPath: mode === 'create' ? project : parent })
    } else expect(switchProject).not.toHaveBeenCalled()
    if (mode === 'existing') expect(await readFile(join(project, 'keep.txt'), 'utf8')).toBe('original')
    expect({ mode, entries, switches: switchProject.mock.calls.length, errors: api.error.mock.calls.length }).toMatchSnapshot()
  } finally {
    for (const subscription of subscriptions.reverse()) subscription.dispose()
    await rm(parent, { recursive: true, force: true })
  }
})

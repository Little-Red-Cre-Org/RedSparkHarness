/** Editor and AI execution share upstream tasks and their interactive terminals. */
import * as vscode from 'vscode'
import { basename, dirname, resolve, join } from 'node:path'
import { realpath } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { workbenchMessages } from './ide-locale.ts'

type Messages = ReturnType<typeof workbenchMessages>
interface RunRecord { id: string; file: string; cwd: string; state: 'running' | 'exited'; exitCode?: number }

/**
 * Register file/task execution and connect the private AI tool channel.
 * @param context - extension owner for commands, events and the connection.
 * @param t - localized controls.
 * @param activeEditor - last code editor, retained when the chat receives focus.
 */
export function installIdeRun(context: vscode.ExtensionContext, t: Messages, activeEditor: () => vscode.TextEditor | undefined): void {
  const runs = new Map<vscode.TaskExecution, RunRecord>()
  const checkTrust = (): void => { if (!vscode.workspace.isTrusted) throw new Error(t.runTrust) }
  const normalize = (path: string): string => process.platform === 'win32' ? path.toLowerCase() : path
  const launch = async (
    projectTask: boolean, ai: boolean, taskName?: string, requestedWorkspace?: string, signal?: AbortSignal,
  ): Promise<RunRecord | undefined> => {
    checkTrust()
    signal?.throwIfAborted()
    let task: vscode.Task
    let file: string
    let cwd: string
    if (projectTask) {
      const tasks = await vscode.tasks.fetchTasks()
      const choices = tasks.filter(item => item.source !== 'RSH')
      if (choices.length === 0) throw new Error(t.runNoTasks)
      const selected = taskName === undefined
        ? (await vscode.window.showQuickPick(
          choices.map(value => ({ label: value.name, description: value.source, value })), { placeHolder: t.runProject },
        ))?.value
        : choices.find(item => item.name === taskName)
      if (selected === undefined) {
        if (taskName !== undefined) throw new Error(t.runTaskMissing)
        return undefined
      }
      task = selected
      file = selected.name
      cwd = typeof selected.scope === 'object' ? selected.scope.uri.fsPath : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
      if (!await vscode.workspace.saveAll(false)) throw new Error(t.saveFailed)
    } else {
      let editor = activeEditor()
      if (editor === undefined || editor.document.isClosed) throw new Error(t.runNoFile)
      if (editor.document.isUntitled) {
        await vscode.window.showTextDocument(editor.document, vscode.ViewColumn.One)
        await vscode.commands.executeCommand('workbench.action.files.save')
        editor = vscode.window.activeTextEditor
        if (editor === undefined || editor.document.isUntitled) return undefined
      }
      const document = editor.document
      if (!['file', 'vscode-remote'].includes(document.uri.scheme)) throw new Error(t.runNoFile)
      if (!['python', 'java', 'c', 'cpp'].includes(document.languageId)) {
        if (ai) throw new Error(t.runUseTask)
        if (await vscode.window.showInformationMessage(t.runUseTask, t.runProject) === t.runProject) {
          return launch(true, false)
        }
        return undefined
      }
      if (!await document.save()) throw new Error(t.saveFailed)
      file = document.uri.fsPath
      const folder = vscode.workspace.getWorkspaceFolder(document.uri)
      cwd = folder?.uri.fsPath ?? dirname(file)
      const config = vscode.workspace.getConfiguration('rsh', document.uri)
      const env: Record<string, string> = {}
      for (const key of Object.keys(process.env)) if (/KEY|SECRET|TOKEN|PASSWORD|^RSH_|^DSH_/i.test(key)) env[key] = ''
      let processExecution: vscode.ProcessExecution
      if (document.languageId === 'java') {
        const java = config.get<string>('javaExecutable')
        const javac = config.get<string>('javacExecutable')
        if (!java?.trim() || !javac?.trim()) throw new Error(t.runJavaMissing)
        processExecution = new vscode.ProcessExecution(process.execPath,
          [join(context.extensionPath, 'java-runner.cjs'), file, java, javac, t.runJavaMissing], { cwd, env })
      } else if (document.languageId === 'c' || document.languageId === 'cpp') {
        const compiler = config.get<string>(document.languageId === 'c' ? 'cCompiler' : 'cppCompiler')
        if (!compiler?.trim()) throw new Error(t.runCompilerMissing)
        processExecution = new vscode.ProcessExecution(process.execPath,
          [join(context.extensionPath, 'c-runner.cjs'), file, compiler, t.runCompilerMissing], { cwd, env })
      } else {
        const python = config.get<string>('pythonExecutable')
        if (!python?.trim()) throw new Error(t.runPythonMissing)
        processExecution = new vscode.ProcessExecution(python, ['-u', file], { cwd, env })
      }
      task = new vscode.Task({ type: 'rsh', file }, folder ?? vscode.TaskScope.Workspace,
        basename(file), 'RSH', processExecution)
      if (document.languageId !== 'python') task.presentationOptions = { echo: false }
    }
    if (requestedWorkspace !== undefined && normalize(await realpath(cwd)) !== normalize(requestedWorkspace)) {
      throw new Error(t.selectionWorkspace)
    }
    if ([...runs.values()].some(row => row.file === file && row.cwd === cwd && row.state === 'running')) throw new Error(t.runAlreadyRunning)
    if (ai && await vscode.window.showWarningMessage(`${t.runAiConfirm}\n${file}\n${cwd}`, { modal: true }, t.runFile) !== t.runFile) {
      throw new Error(t.runDeclined)
    }
    checkTrust()
    signal?.throwIfAborted()
    task.presentationOptions = {
      ...task.presentationOptions, reveal: vscode.TaskRevealKind.Always,
      focus: true, panel: vscode.TaskPanelKind.Dedicated, clear: true,
    }
    await vscode.commands.executeCommand('workbench.action.positionPanelBottom')
    signal?.throwIfAborted()
    const execution = await vscode.tasks.executeTask(task)
    const record: RunRecord = { id: randomUUID(), file, cwd, state: 'running' }
    runs.set(execution, record)
    return record
  }
  const stop = (id?: string): void => {
    for (const [execution, row] of runs) if (row.state === 'running' && (id === undefined || row.id === id)) execution.terminate()
  }
  const command = (id: string, action: () => Promise<unknown>): vscode.Disposable => vscode.commands.registerCommand(id,
    () => action().catch((error: unknown) => { void vscode.window.showErrorMessage(`${t.error}: ${String(error)}`) }))
  context.subscriptions.push(
    command('rsh.runFile', () => launch(false, false)),
    command('rsh.runProject', () => launch(true, false)),
    vscode.commands.registerCommand('rsh.stopRun', () => { stop() }),
    vscode.tasks.onDidEndTaskProcess(({ execution, exitCode }) => {
      const row = runs.get(execution)
      if (row !== undefined) { row.state = 'exited'; if (exitCode !== undefined) row.exitCode = exitCode }
    }),
    vscode.tasks.onDidEndTask(({ execution }) => { const row = runs.get(execution); if (row !== undefined) row.state = 'exited' }),
  )
  const endpoint = process.env.RSH_IDE_EXECUTOR_URL
  if (endpoint === undefined) return
  const socket = new WebSocket(endpoint)
  const requests = new Map<string, AbortController>()
  socket.addEventListener('close', () => { for (const request of requests.values()) request.abort() })
  socket.addEventListener('error', () => { void vscode.window.showErrorMessage(t.runBridgeFailed) })
  socket.addEventListener('message', (event) => {
    void (async () => {
      const value: unknown = JSON.parse(String(event.data))
      if (typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string'
        && 'action' in value && value.action === 'cancel') { requests.get(value.id)?.abort(); return }
      if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'string'
        || !('action' in value) || !['file', 'task', 'status', 'stop'].includes(String(value.action))
        || !('workspace' in value) || typeof value.workspace !== 'string'
        || ('task' in value && typeof value.task !== 'string') || ('runId' in value && typeof value.runId !== 'string')) return
      const controller = new AbortController()
      requests.set(value.id, controller)
      try {
        const requested = await realpath(resolve(value.workspace))
        const folders = await Promise.all((vscode.workspace.workspaceFolders ?? []).map(folder => realpath(folder.uri.fsPath)))
        if (!folders.some(folder => normalize(folder) === normalize(requested))) throw new Error(t.selectionWorkspace)
        let result: unknown
        const workspaceRuns = [...runs.values()].filter(row => normalize(row.cwd) === normalize(requested))
        if (value.action === 'status') result = workspaceRuns
        else if (value.action === 'stop') {
          if (!('runId' in value) || !workspaceRuns.some(row => row.id === value.runId)) throw new Error(t.runUnknown)
          stop(value.runId as string); result = { stopRequested: true }
        }
        else result = await launch(value.action === 'task', true, 'task' in value ? value.task as string : undefined, requested, controller.signal)
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: value.id, result: result ?? { cancelled: true } }))
      } catch (error) {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: value.id, error: String(error) }))
      } finally { requests.delete(value.id) }
    })().catch((error: unknown) => { void vscode.window.showErrorMessage(`${t.error}: ${String(error)}`) })
  })
  context.subscriptions.push({ dispose() { socket.close() } })
}

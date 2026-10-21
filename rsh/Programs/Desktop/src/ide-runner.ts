/** Run a saved source file as an interactive Code OSS terminal task. */
import * as vscode from 'vscode'
import { mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { workbenchMessages } from './ide-locale.ts'

/**
 * Register run and stop controls; task terminals own process input and termination.
 * @param context - extension lifetime.
 * @param t - localized runner labels.
 */
export function installIdeRunner(context: vscode.ExtensionContext, t: ReturnType<typeof workbenchMessages>): void {
  const executions = new Set<vscode.TaskExecution>()
  context.subscriptions.push(
    vscode.tasks.onDidEndTask(event => {
      executions.delete(event.execution)
      void vscode.commands.executeCommand('setContext', 'rsh.codeRunning', executions.size > 0)
    }),
    vscode.commands.registerCommand('rsh.stopCode', () => {
      for (const execution of executions) execution.terminate()
    }),
    vscode.commands.registerCommand('rsh.runFile', async () => {
      try {
        const document = vscode.window.activeTextEditor?.document
        if (!document) return
        const language = document.languageId
        if (!['c', 'cpp', 'python', 'javascript', 'typescript', 'java'].includes(language)) {
          await vscode.window.showInformationMessage(t.runUnsupported)
          return
        }
        if (document.isUntitled) { await vscode.window.showInformationMessage(t.runSaveFirst); return }
        if (!document.getText().trim()) return
        if (executions.size > 0) { await vscode.window.showInformationMessage(t.runBusy); return }
        if (!await document.save()) return
        const config = vscode.workspace.getConfiguration('rsh')
        const tools = config.get<Record<string, string>>('runnerExecutables')!
        const file = document.uri.fsPath
        const directory = join(tmpdir(), 'rsh-ide-run', createHash('sha256').update(file).digest('hex').slice(0, 16))
        await mkdir(directory, { recursive: true })
        const task = new vscode.Task({ type: 'rsh-file', file }, vscode.TaskScope.Workspace,
          `${t.runFile}: ${basename(file)}`, 'RSH', new vscode.ProcessExecution(process.execPath,
            [join(context.extensionPath, 'run-file.cjs'), language, file, directory, tools[language]!, tools.javac!],
            { cwd: dirname(file) }), language === 'c' || language === 'cpp' ? ['$rsh-gcc'] : [])
        task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, focus: true, panel: vscode.TaskPanelKind.Dedicated, clear: true, echo: false }
        executions.add(await vscode.tasks.executeTask(task))
        await vscode.commands.executeCommand('setContext', 'rsh.codeRunning', true)
      } catch (error: unknown) {
        await vscode.window.showErrorMessage(`${t.runFailed}: ${String(error)}`)
      }
    }),
  )
}

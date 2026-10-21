/** Project directory controls in the RSH AI toolbar. */
import * as vscode from 'vscode'
import { mkdir } from 'node:fs/promises'
import type { workbenchMessages } from './ide-locale.ts'

/**
 * Register project creation, folder selection and empty editor commands.
 * @param context - Extension owner for command disposal.
 * @param t - Localized prompts and errors.
 * @param switchProject - Save editors and replace the shared project folder.
 */
export function installIdeProjects(
  context: vscode.ExtensionContext,
  t: ReturnType<typeof workbenchMessages>,
  switchProject: (folder: vscode.Uri) => Promise<void>,
): void {
  const choose = async (create: boolean): Promise<void> => {
    const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri
    const folders = await vscode.window.showOpenDialog({
      canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
      title: create ? t.projectLocation : t.openProject,
      openLabel: create ? t.chooseLocation : t.openProject,
      ...(defaultUri === undefined ? {} : { defaultUri }),
    })
    const parent = folders?.[0]
    if (parent === undefined) return
    let folder = parent
    if (create) {
      const name = await vscode.window.showInputBox({
        title: t.newProject, prompt: t.projectName, ignoreFocusOut: true,
        validateInput: value => value.trim() === '' || value !== value.trim() || value === '.' || value === '..'
          || /[<>:"/\\|?*\u0000-\u001f]/u.test(value) || value.endsWith('.') ? t.invalidProjectName : undefined,
      })
      if (name === undefined) return
      folder = vscode.Uri.joinPath(parent, name)
      // Exclusive creation keeps an existing project untouched.
      await mkdir(folder.fsPath)
    }
    await switchProject(folder)
  }
  const run = (create: boolean): Promise<void> => choose(create).catch((error: unknown) => {
    void vscode.window.showErrorMessage(`${t.error}: ${String(error)}`)
  })
  context.subscriptions.push(
    vscode.commands.registerCommand('rsh.newProject', () => run(true)),
    vscode.commands.registerCommand('rsh.openProject', () => run(false)),
    vscode.commands.registerCommand('rsh.newFile', async () => {
      await vscode.commands.executeCommand('workbench.action.files.newUntitledFile')
    }),
  )
}

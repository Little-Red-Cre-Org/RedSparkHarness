/** User-requested code insertion and immutable previews in the Code OSS editor. */
import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import type { workbenchMessages } from './ide-locale.ts'

interface Proposal {
  readonly document: vscode.TextDocument
  readonly version: number
  readonly range: vscode.Range
  readonly code: string
  readonly before: string
  readonly after: string
}

/**
 * Own proposal documents and explicit apply/discard commands.
 * @param context - extension lifecycle owner.
 * @param t - localized editor actions and failures.
 * @returns handler for a validated user code action and its last focused editor.
 */
export function installIdeCodeActions(context: vscode.ExtensionContext, t: ReturnType<typeof workbenchMessages>) {
  const proposals = new Map<string, Proposal>()
  const currentId = (): string | undefined => {
    const input: unknown = vscode.window.tabGroups.activeTabGroup.activeTab?.input
    return input instanceof vscode.TabInputTextDiff && input.modified.scheme === 'rsh-proposal'
      ? input.modified.authority : undefined
  }
  const fail = (error: unknown): void => { void vscode.window.showErrorMessage(`${t.error}: ${String(error)}`) }
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('rsh-proposal', {
      provideTextDocumentContent(uri) {
        const proposal = proposals.get(uri.authority)
        if (proposal === undefined) throw new Error(t.proposalExpired)
        return uri.query === 'before' ? proposal.before : proposal.after
      },
    }),
    vscode.window.tabGroups.onDidChangeTabs(({ closed }) => {
      for (const tab of closed) {
        const input: unknown = tab.input
        if (input instanceof vscode.TabInputTextDiff && input.modified.scheme === 'rsh-proposal') proposals.delete(input.modified.authority)
      }
    }),
    vscode.commands.registerCommand('rsh.applyCode', async () => {
      const id = currentId()
      if (id === undefined) return
      const proposal = proposals.get(id)
      if (proposal === undefined) return
      try {
        if (proposal.document.isClosed || proposal.document.version !== proposal.version) throw new Error(t.proposalChanged)
        const editor = await vscode.window.showTextDocument(proposal.document, { viewColumn: vscode.ViewColumn.One, preview: false })
        if (proposal.document.version !== proposal.version) throw new Error(t.proposalChanged)
        if (!await editor.edit((edit) => { edit.replace(proposal.range, proposal.code) })) throw new Error(t.codeEditFailed)
        proposals.delete(id)
        const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter((tab) => {
          const input: unknown = tab.input
          return input instanceof vscode.TabInputTextDiff && input.modified.authority === id && input.modified.scheme === 'rsh-proposal'
        })
        await vscode.window.tabGroups.close(tabs)
      } catch (error) { fail(error) }
    }),
    vscode.commands.registerCommand('rsh.discardCode', async () => {
      if (currentId() !== undefined) await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    }),
    { dispose: () => { proposals.clear() } },
  )
  return async (mode: 'insert' | 'preview', code: string, language: string | undefined, active: vscode.TextEditor | undefined): Promise<void> => {
    const document = active?.document ?? await vscode.workspace.openTextDocument({ content: '', ...(language === undefined ? {} : { language }) })
    const selection = active?.selection ?? new vscode.Selection(0, 0, 0, 0)
    if (mode === 'insert') {
      const version = document.version
      const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false })
      if (document.version !== version) throw new Error(t.proposalChanged)
      if (!await editor.edit((edit) => { edit.replace(selection, code) })) throw new Error(t.codeEditFailed)
      return
    }
    const before = document.getText()
    const range = selection.isEmpty ? new vscode.Range(document.positionAt(0), document.positionAt(before.length)) : selection
    const after = before.slice(0, document.offsetAt(range.start)) + code + before.slice(document.offsetAt(range.end))
    const id = randomUUID()
    const uri = vscode.Uri.from({ scheme: 'rsh-proposal', authority: id, path: `/${document.uri.path.split('/').pop() ?? 'code'}`, query: 'before' })
    proposals.set(id, { document, version: document.version, range, code, before, after })
    try {
      await vscode.commands.executeCommand('vscode.diff', uri, uri.with({ query: 'after' }),
        `${t.codePreview} — ${selection.isEmpty ? t.wholeFile : t.selectedCode}`, { viewColumn: vscode.ViewColumn.One, preview: false })
    } catch (error) { proposals.delete(id); throw error }
  }
}

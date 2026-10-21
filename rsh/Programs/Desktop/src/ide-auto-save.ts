/** Debounced file saves and Desktop shutdown flushing through the launch-owned directory. */
import * as vscode from 'vscode'
import { readFileSync, renameSync, watch, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import type { workbenchMessages } from './ide-locale.ts'

/**
 * Save changed files after the configured delay and flush before Desktop leaves the IDE.
 * @param context - extension lifetime owning timers and the private request watcher.
 * @param state - Desktop-owned editor-state file in the private launch directory.
 * @param messages - localized configuration and save errors.
 * @returns a flush operation that rejects while any editor remains unsaved.
 */
export function installIdeAutoSave(
  context: vscode.ExtensionContext, state: string, messages: ReturnType<typeof workbenchMessages>,
): () => Promise<void> {
  const timers = new Map<vscode.TextDocument, ReturnType<typeof setTimeout>>()
  const report = (error: unknown): void => { void vscode.window.showErrorMessage(`${messages.saveFailed} ${String(error)}`) }
  const delay = (): number => {
    const value = vscode.workspace.getConfiguration('rsh').get<unknown>('autoSaveDelay')
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 100 || value > 10000) {
      throw new Error(messages.autoSaveInvalid)
    }
    return value
  }
  const cancel = (document: vscode.TextDocument): void => { clearTimeout(timers.get(document)); timers.delete(document) }
  const schedule = (document: vscode.TextDocument): void => {
    cancel(document)
    if (!document.isDirty || document.isUntitled || document.isClosed) return
    const milliseconds = delay()
    timers.set(document, setTimeout(() => {
      timers.delete(document)
      if (document.isDirty && !document.isClosed) {
        void document.save().then((saved) => { if (!saved) report(document.uri.fsPath) }, report)
      }
    }, milliseconds))
  }
  const flush = async (): Promise<void> => {
    for (const document of timers.keys()) cancel(document)
    if (!await vscode.workspace.saveAll(false)
      || vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.isDirty))) throw new Error(messages.saveFailed)
  }
  // Focus-change saving also lets Code OSS close a changed file before its debounce expires.
  const configureClose = async (): Promise<void> => {
    const files = vscode.workspace.getConfiguration('files')
    if (files.get('autoSave') !== 'onFocusChange') await files.update('autoSave', 'onFocusChange', vscode.ConfigurationTarget.Workspace)
    const window = vscode.workspace.getConfiguration('window')
    if (window.get('confirmBeforeClose') !== 'never') await window.update('confirmBeforeClose', 'never', vscode.ConfigurationTarget.Global)
  }
  delay()
  void configureClose().catch(report)
  let request: string | undefined
  const watcher = watch(dirname(state), { persistent: false }, (_event, name) => {
    if (name !== `${basename(state)}.save-request`) return
    try {
      const id = readFileSync(`${state}.save-request`, 'utf8')
      if (id === request) return
      if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid Desktop save request')
      request = id
      void flush().then(() => ({ id, ok: true }), () => ({ id, ok: false })).then((result) => {
        writeFileSync(`${state}.save-result.tmp`, JSON.stringify(result))
        renameSync(`${state}.save-result.tmp`, `${state}.save-result`)
      }).catch(report)
    } catch (error) { report(error) }
  })
  watcher.on('error', report)
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      try { schedule(event.document) } catch (error) { report(error) }
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      try { schedule(document) } catch (error) { report(error) }
    }),
    vscode.workspace.onDidCloseTextDocument(cancel),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('files.autoSave') || event.affectsConfiguration('window.confirmBeforeClose')) {
        void configureClose().catch(report)
      }
      if (event.affectsConfiguration('rsh.autoSaveDelay')) {
        try { delay(); for (const document of vscode.workspace.textDocuments) schedule(document) } catch (error) { report(error) }
      }
    }),
    { dispose: () => { watcher.close(); for (const document of timers.keys()) cancel(document) } },
  )
  for (const document of vscode.workspace.textDocuments) schedule(document)
  return flush
}

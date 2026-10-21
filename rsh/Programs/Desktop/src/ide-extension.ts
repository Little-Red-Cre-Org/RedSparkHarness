/** Code OSS extension: a retained RSH conversation sidebar beside workspace editors. */
import * as vscode from 'vscode'
import { randomBytes } from 'node:crypto'
import { renameSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute } from 'node:path'
import { workbenchMessages } from './ide-locale.ts'
import { installIdeAutoSave } from './ide-auto-save.ts'

interface TaskRow {
  readonly id: string
  readonly title: string
  readonly running: boolean
}

/**
 * Register workbench UI against the Desktop-supplied conversation capability.
 * @param context - upstream extension owner; all contributions dispose with it.
 */
export function activate(context: vscode.ExtensionContext): void {
  const address = process.env.RSH_WORKBENCH_URL
  if (address === undefined) return
  const target = new URL(address)
  if (target.protocol !== 'dsh-app:' || !target.hostname.startsWith('ide-')) throw new Error('RSH: invalid Desktop workbench address')
  const channel = target.searchParams.get('channel')
  if (channel === null) throw new Error('RSH: missing workbench channel')
  const editorState = process.env.RSH_WORKBENCH_STATE
  if (editorState === undefined || !isAbsolute(editorState)) throw new Error('RSH: missing Desktop editor-state file')
  const t = workbenchMessages(target.searchParams.get('locale') ?? vscode.env.language)
  const saveEditors = installIdeAutoSave(context, editorState, t)
  const diffDocuments = new Map<string, string>()
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('rsh-diff', {
      provideTextDocumentContent(uri) {
        const text = diffDocuments.get(uri.toString())
        if (text === undefined) throw new Error('RSH: change preview has expired')
        return text
      },
    }),
    vscode.workspace.onDidCloseTextDocument((document) => { diffDocuments.delete(document.uri.toString()) }),
    { dispose: () => { diffDocuments.clear() } },
  )
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (folder !== undefined) target.searchParams.set('workspace', folder.uri.fsPath)
  const changes = new vscode.EventEmitter<void>()
  let rows: readonly TaskRow[] = []
  let selected: string | undefined
  let panel: vscode.WebviewView | undefined
  let ready = false
  let workspaceId: string | undefined
  let switchingWorkspace = false
  let blockedWorkspace: string | undefined
  let pending: { type: string; id?: string } | undefined
  let editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor
  let refreshConversation: (() => void) | undefined
  const provider: vscode.TreeDataProvider<TaskRow> = {
    onDidChangeTreeData: changes.event,
    getChildren: () => [...rows],
    getTreeItem(row) {
      const item = new vscode.TreeItem(row.title)
      item.id = row.id
      item.iconPath = new vscode.ThemeIcon(row.running ? 'sync~spin' : row.id === selected ? 'comment-discussion' : 'comment')
      item.command = { command: 'rsh.openTask', title: t.conversation, arguments: [row.id] }
      return item
    },
  }
  const tree = vscode.window.createTreeView('rsh.tasks', { treeDataProvider: provider })
  tree.title = t.tasks
  const send = (message: { type: string; id?: string }): void => {
    if (ready && panel !== undefined) void panel.webview.postMessage({ ...message, channel })
    else pending = message
  }
  const publishEditors = (): void => {
    const dirty = vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.isDirty))
    writeFileSync(`${editorState}.tmp`, dirty ? 'dirty' : 'clean')
    renameSync(`${editorState}.tmp`, editorState)
  }
  publishEditors()
  const open = (): void => {
    if (panel !== undefined) panel.show(true)
    else void vscode.commands.executeCommand('rsh.conversationView.focus')
  }
  const connect = (current: vscode.WebviewView): void => {
    current.webview.options = { enableScripts: true, localResourceRoots: [] }
    panel = current
    ready = false
    const nonce = randomBytes(24).toString('hex')
    refreshConversation = () => {
      ready = false
      const source = target.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
      current.webview.html = `<!doctype html><html><head><meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src dsh-app:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'">
      <style nonce="${nonce}">html,body,iframe{width:100%;height:100%;padding:0;margin:0;border:0;overflow:hidden;background:var(--vscode-editor-background)}</style></head>
      <body><iframe title="${t.conversation}" src="${source}"></iframe><script nonce="${nonce}">
      const api=acquireVsCodeApi(),frame=document.querySelector('iframe'),channel=${JSON.stringify(channel)};
      const appearance=()=>{
        const style=getComputedStyle(document.body);
        const colors=['editor-background','editor-foreground','descriptionForeground','button-background','sideBar-background','panel-border']
          .map(key=>style.getPropertyValue('--vscode-'+key).trim());
        frame.contentWindow.postMessage({type:'appearance',channel,colors,dark:document.body.classList.contains('vscode-dark')||document.body.classList.contains('vscode-high-contrast')},'*');
      };
      new MutationObserver(appearance).observe(document.body,{attributes:true,attributeFilter:['class','style']});
      window.addEventListener('message',event=>{
        const data=event.data;
        if(!data||data.channel!==channel)return;
        if(event.source===frame.contentWindow){
          if(data.type==='appearance-ready'){appearance();return;}
          if(data.type==='ready'){frame.contentWindow.postMessage({type:'connect',channel},'*');appearance();}
          else api.postMessage(data);return;
        }
        // Code OSS masks window.parent; its bootstrap uses the same isolated origin.
        if(event.origin===window.origin)frame.contentWindow.postMessage(data,'*');
      });
      frame.addEventListener('load',()=>{frame.contentWindow.postMessage({type:'connect',channel},'*');appearance();});
      </script></body></html>`
    }
    refreshConversation()
    current.webview.onDidReceiveMessage((value: unknown) => {
      if (typeof value !== 'object' || value === null || !('channel' in value) || value.channel !== channel || !('type' in value)) return
      if (value.type === 'state' && 'tasks' in value && Array.isArray(value.tasks)) {
        if (!('workspace' in value) || typeof value.workspace !== 'string' || !isAbsolute(value.workspace)
          || !('workspaceId' in value) || typeof value.workspaceId !== 'string') return
        const next: TaskRow[] = []
        for (const row of value.tasks as unknown[]) {
          if (typeof row !== 'object' || row === null || !('id' in row) || typeof row.id !== 'string'
            || !('title' in row) || typeof row.title !== 'string' || !('running' in row) || typeof row.running !== 'boolean') return
          next.push({ id: row.id, title: row.title, running: row.running })
        }
        rows = next
        workspaceId = value.workspaceId
        selected = 'selected' in value && typeof value.selected === 'string' ? value.selected : undefined
        current.title = rows.find(row => row.id === selected)?.title ?? t.conversation
        const activeFolder = vscode.workspace.workspaceFolders?.[0]
        const path = vscode.Uri.file(value.workspace).path
        const sameFolder = process.platform === 'win32'
          ? activeFolder?.uri.path.toLowerCase() === path.toLowerCase() : activeFolder?.uri.path === path
        if (!sameFolder) {
          ready = false
          if (!('canSwitchWorkspace' in value) || value.canSwitchWorkspace !== true) {
            if (blockedWorkspace !== value.workspaceId) void vscode.window.showWarningMessage(t.workspacePending)
            blockedWorkspace = value.workspaceId
            return
          }
          blockedWorkspace = undefined
          if (switchingWorkspace) return
          switchingWorkspace = true
          const uri = activeFolder === undefined ? vscode.Uri.file(value.workspace) : activeFolder.uri.with({ path })
          void saveEditors().then(() => {
            if (!vscode.workspace.updateWorkspaceFolders(0, vscode.workspace.workspaceFolders?.length ?? 0, { uri })) {
              throw new Error(t.workspaceFailed)
            }
          }).catch((error: unknown) => {
            switchingWorkspace = false
            void vscode.window.showErrorMessage(String(error))
          })
          return
        }
        ready = true
        changes.fire()
        if (pending !== undefined) { const message = pending; pending = undefined; send(message) }
      } else if (value.type === 'answer-code' && 'sessionId' in value && value.sessionId === selected
        && 'blocks' in value && Array.isArray(value.blocks)) {
        const blocks: { language: string; content: string }[] = []
        for (const block of value.blocks as unknown[]) {
          if (typeof block !== 'object' || block === null || !('language' in block) || typeof block.language !== 'string'
            || !('content' in block) || typeof block.content !== 'string') return
          blocks.push({ language: block.language, content: block.content })
        }
        void (async () => {
          const languages = await vscode.languages.getLanguages()
          const aliases: Record<string, string> = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'shellscript', bash: 'shellscript', csharp: 'csharp', cs: 'csharp', 'c++': 'cpp' }
          for (const block of blocks) {
            const requested = block.language.toLowerCase()
            const language = aliases[requested] ?? requested
            const document = await vscode.workspace.openTextDocument({ content: block.content, language: languages.includes(language) ? language : 'plaintext' })
            await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false, preserveFocus: true })
          }
        })().catch((error: unknown) => { void vscode.window.showErrorMessage(String(error)) })
      } else if (value.type === 'selection-rejected' && 'reason' in value) {
        void vscode.window.showWarningMessage(value.reason === 'busy' ? t.selectionBusy : t.selectionWorkspace)
      } else if (value.type === 'open-file' && 'path' in value && typeof value.path === 'string' && isAbsolute(value.path)) {
        if ('diffs' in value) {
          if (!Array.isArray(value.diffs) || value.diffs.length === 0) return
          const diffs: { oldText: string | null; newText: string }[] = []
          for (const diff of value.diffs as unknown[]) {
            if (typeof diff !== 'object' || diff === null || !('oldText' in diff) || !('newText' in diff)
              || (diff.oldText !== null && typeof diff.oldText !== 'string') || typeof diff.newText !== 'string') return
            diffs.push({ oldText: diff.oldText, newText: diff.newText })
          }
          const name = basename(value.path)
          const show = async (): Promise<void> => {
            for (const [index, diff] of diffs.entries()) {
              const id = randomBytes(16).toString('hex')
              const before = vscode.Uri.from({ scheme: 'rsh-diff', path: `/${id}/${name}`, query: 'before' })
              const after = before.with({ query: 'after' })
              diffDocuments.set(before.toString(), diff.oldText ?? '')
              diffDocuments.set(after.toString(), diff.newText)
              try {
                await vscode.commands.executeCommand('vscode.diff', before, after,
                  `${name} — ${t.diff} ${index + 1}/${diffs.length} (${diff.oldText === null ? t.unknownBefore : t.before} → ${t.after})`,
                  { viewColumn: vscode.ViewColumn.One, preview: false })
              } catch (error) {
                diffDocuments.delete(before.toString()); diffDocuments.delete(after.toString())
                throw error
              }
            }
          }
          void show().catch((error: unknown) => { void vscode.window.showErrorMessage(`${t.error}: ${String(error)}`) })
          return
        }
        const line = 'line' in value ? value.line : undefined
        if (line !== undefined && (typeof line !== 'number' || !Number.isSafeInteger(line) || line < 1)) return
        const path = vscode.Uri.file(value.path).path
        const folderUri = vscode.workspace.workspaceFolders?.[0]?.uri
        const uri = folderUri === undefined ? vscode.Uri.file(value.path) : folderUri.with({ path })
        const position = line === undefined ? undefined : new vscode.Position(line - 1, 0)
        void vscode.window.showTextDocument(uri, {
          viewColumn: vscode.ViewColumn.One,
          ...(position === undefined ? {} : { selection: new vscode.Range(position, position) }),
        }).then(undefined, (error: unknown) => { void vscode.window.showErrorMessage(`${t.error}: ${String(error)}`) })
      } else if (value.type === 'error' && 'message' in value && typeof value.message === 'string') {
        void vscode.window.showErrorMessage(`${t.error}: ${value.message}`)
      }
    }, undefined, context.subscriptions)
    current.onDidDispose(() => { panel = undefined; ready = false; refreshConversation = undefined }, undefined, context.subscriptions)
  }
  const newFile = async (): Promise<void> => {
    const document = await vscode.workspace.openTextDocument({ language: 'plaintext' })
    await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false })
  }
  const returnRsh = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  returnRsh.text = `$(arrow-left) ${t.returnRsh}`
  returnRsh.command = 'rsh.return'
  returnRsh.show()
  const coding = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101)
  coding.text = `$(code) ${t.coding}`
  coding.command = 'rsh.coding'
  coding.show()
  const conversation = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 102)
  conversation.text = `$(comment-discussion) ${t.conversation}`
  conversation.command = 'rsh.conversation'
  conversation.show()
  context.subscriptions.push(changes, tree, coding, conversation, returnRsh,
    vscode.window.registerWebviewViewProvider('rsh.conversationView', { resolveWebviewView: connect },
      { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('rsh.newFile', newFile),
    vscode.commands.registerCommand('rsh.renameFile', async (resource?: vscode.Uri) => {
      const uri = resource ?? vscode.window.activeTextEditor?.document.uri
      if (!uri) return
      const name = await vscode.window.showInputBox({
        title: t.renameFile, value: basename(uri.path),
        validateInput: value => !value.trim() || /[<>:"/\\|?*\x00-\x1f]/u.test(value)
          || /[. ]$/u.test(value) ? t.invalidFileName : undefined,
      })
      if (name === undefined) return
      if (uri.scheme === 'untitled') {
        const directory = vscode.workspace.workspaceFolders?.[0]?.uri
        if (!directory) { await vscode.window.showInformationMessage(t.renameNeedsFolder); return }
        const destination = vscode.Uri.joinPath(directory, name)
        const document = await vscode.workspace.openTextDocument(uri)
        const text = document.getText()
        const edit = new vscode.WorkspaceEdit()
        edit.createFile(destination, { overwrite: false, contents: Buffer.from(text, 'utf8') })
        try {
          if (!await vscode.workspace.applyEdit(edit)) { await vscode.window.showErrorMessage(t.renameFailed); return }
        } catch (error) {
          await vscode.window.showErrorMessage(`${t.renameFailed}: ${String(error)}`)
          return
        }
        if (document.getText() === text) {
          await vscode.window.showTextDocument(document, { preview: false })
          await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
        }
        await vscode.window.showTextDocument(destination, { preview: false })

      } else {
        const edit = new vscode.WorkspaceEdit()
        edit.renameFile(uri, vscode.Uri.joinPath(uri, '..', name), { overwrite: false })
        if (!await vscode.workspace.applyEdit(edit)) await vscode.window.showErrorMessage(t.renameFailed)
      }
    }),
    vscode.commands.registerCommand('rsh.return', async () => { await saveEditors(); open(); send({ type: 'return-rsh' }) }),
    vscode.window.tabGroups.onDidChangeTabs(publishEditors),
    vscode.window.onDidChangeActiveTextEditor((active) => { if (active !== undefined) editor = active }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const activeFolder = vscode.workspace.workspaceFolders?.[0]
      if (activeFolder === undefined) return
      target.searchParams.set('workspace', activeFolder.uri.fsPath)
      switchingWorkspace = false
      refreshConversation?.()
    }),
    vscode.commands.registerTextEditorCommand('rsh.addSelection', (active) => {
      if (!ready || switchingWorkspace || workspaceId === undefined) {
        void vscode.window.showWarningMessage(t.selectionWorkspace)
        return
      }
      const chunks = active.selections.filter(selection => !selection.isEmpty).map((selection) => {
        const text = active.document.getText(selection)
        const fence = '`'.repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), match => match[0].length + 1)))
        const path = vscode.workspace.asRelativePath(active.document.uri, false)
        const start = `${selection.start.line + 1}:${selection.start.character + 1}`
        const end = `${selection.end.line + 1}:${selection.end.character + 1}`
        return `${path}:${start}-${end}\n${fence}${active.document.languageId}\n${text}\n${fence}`
      })
      if (chunks.length === 0) return
      open()
      void panel?.webview.postMessage({ type: 'selection', channel, workspaceId, text: chunks.join('\n\n') })
    }),
    vscode.commands.registerCommand('rsh.conversation', open),
    vscode.commands.registerCommand('rsh.openTask', (id: string) => { open(); send({ type: 'select-session', id }) }),
    vscode.commands.registerCommand('rsh.newTask', () => { open(); send({ type: 'new-session' }) }),
    vscode.commands.registerCommand('rsh.coding', async () => {
      if (editor !== undefined && !editor.document.isClosed) await vscode.window.showTextDocument(editor.document, vscode.ViewColumn.One)
      else await newFile()
    }),
  )
  open()
  if (vscode.window.tabGroups.all.every(group => group.tabs.length === 0)) void newFile()
}

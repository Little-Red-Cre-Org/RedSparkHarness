Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let vscode = require("vscode");
vscode = __toESM(vscode, 1);
let node_crypto = require("node:crypto");
let node_fs = require("node:fs");
let node_path = require("node:path");
//#region lib/types/ide-locale.js
/** Localized labels shared by the bundled extension manifest and runtime. */
const dictionaries = {
	en: {
		autoSaveDelay: "Auto-save delay in milliseconds. Integer from 100 to 10000; default 500. Each edit restarts the timer.",
		autoSaveInvalid: "Auto-save delay must be an integer from 100 to 10000 ms.",
		saveFailed: "Automatic saving did not finish. Check file permissions, conflicts, or choose a path for new files.",
		returnRsh: "Return to RSH",
		applyCode: "Apply code",
		discardCode: "Discard preview",
		codePreview: "Review AI code",
		wholeFile: "Replace entire file",
		selectedCode: "Replace selection",
		proposalExpired: "This code preview has expired.",
		proposalChanged: "The target file changed. Create a new preview before applying.",
		codeEditFailed: "The editor could not apply the code.",
		conversation: "RSH AI",
		tasks: "Project tasks",
		coding: "Coding",
		error: "RSH workbench",
		newTask: "New task",
		addSelection: "Add selection to task",
		selectionBusy: "The task input is busy. Try adding the selection again after it finishes.",
		selectionWorkspace: "Wait for the task project to open, then add the selection again.",
		workspaceFailed: "Could not switch the editor project. Reopen the IDE before editing this task.",
		workspacePending: "The editor project switch is waiting. Finish the input operation and send or remove draft attachments first.",
		diff: "Recorded change fragments",
		before: "Before",
		after: "After",
		unknownBefore: "Previous text not recorded"
	},
	zh: {
		autoSaveDelay: "自动保存延迟（毫秒）。100–10000 的整数，默认 500；每次编辑重新计时。",
		autoSaveInvalid: "自动保存延迟必须是 100–10000 ms 的整数。",
		saveFailed: "自动保存未完成，请检查文件权限、内容冲突，或先为新文件选择保存路径。",
		returnRsh: "返回 RSH",
		applyCode: "应用代码",
		discardCode: "放弃预览",
		codePreview: "审核 AI 代码",
		wholeFile: "替换整个文件",
		selectedCode: "替换选区",
		proposalExpired: "代码预览已失效。",
		proposalChanged: "目标文件已修改，请重新预览后再应用。",
		codeEditFailed: "编辑器未能应用代码。",
		conversation: "RSH AI",
		tasks: "项目任务",
		coding: "编码",
		error: "RSH 工作台",
		newTask: "新建任务",
		addSelection: "将选中代码加入任务",
		selectionBusy: "任务输入框正在处理内容，请稍后重新添加选中代码。",
		selectionWorkspace: "请等待任务项目打开后，再添加选中代码。",
		workspaceFailed: "编辑器项目切换失败，请重新打开 IDE 后再编辑此任务。",
		workspacePending: "编辑器项目切换已暂缓。请等待输入操作结束，并先发送或移除草稿附件。",
		diff: "修改记录片段",
		before: "修改前",
		after: "修改后",
		unknownBefore: "未记录原文"
	}
};
/**
* Resolve RSH controls independently of upstream language-pack availability.
* @param locale - Desktop locale, or the upstream locale for standalone use.
* @returns labels for the supported locale.
*/
function workbenchMessages(locale) {
	return locale.toLowerCase().startsWith("zh") ? dictionaries.zh : dictionaries.en;
}
//#endregion
//#region lib/types/ide-auto-save.js
/** Debounced file saves and Desktop shutdown flushing through the launch-owned directory. */
/**
* Save changed files after the configured delay and flush before Desktop leaves the IDE.
* @param context - extension lifetime owning timers and the private request watcher.
* @param state - Desktop-owned editor-state file in the private launch directory.
* @param messages - localized configuration and save errors.
* @returns a flush operation that rejects while any editor remains unsaved.
*/
function installIdeAutoSave(context, state, messages) {
	const timers = /* @__PURE__ */ new Map();
	const report = (error) => {
		vscode.window.showErrorMessage(`${messages.saveFailed} ${String(error)}`);
	};
	const delay = () => {
		const value = vscode.workspace.getConfiguration("rsh").get("autoSaveDelay");
		if (typeof value !== "number" || !Number.isInteger(value) || value < 100 || value > 1e4) throw new Error(messages.autoSaveInvalid);
		return value;
	};
	const cancel = (document) => {
		clearTimeout(timers.get(document));
		timers.delete(document);
	};
	const schedule = (document) => {
		cancel(document);
		if (!document.isDirty || document.isUntitled || document.isClosed) return;
		const milliseconds = delay();
		timers.set(document, setTimeout(() => {
			timers.delete(document);
			if (document.isDirty && !document.isClosed) document.save().then((saved) => {
				if (!saved) report(document.uri.fsPath);
			}, report);
		}, milliseconds));
	};
	const flush = async () => {
		for (const document of timers.keys()) cancel(document);
		if (!await vscode.workspace.saveAll(false) || vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) => tab.isDirty))) throw new Error(messages.saveFailed);
	};
	const configureClose = async () => {
		const files = vscode.workspace.getConfiguration("files");
		if (files.get("autoSave") !== "onFocusChange") await files.update("autoSave", "onFocusChange", vscode.ConfigurationTarget.Workspace);
		const window = vscode.workspace.getConfiguration("window");
		if (window.get("confirmBeforeClose") !== "never") await window.update("confirmBeforeClose", "never", vscode.ConfigurationTarget.Global);
	};
	delay();
	configureClose().catch(report);
	let request;
	const watcher = (0, node_fs.watch)((0, node_path.dirname)(state), { persistent: false }, (_event, name) => {
		if (name !== `${(0, node_path.basename)(state)}.save-request`) return;
		try {
			const id = (0, node_fs.readFileSync)(`${state}.save-request`, "utf8");
			if (id === request) return;
			if (!/^[a-f0-9]{32}$/.test(id)) throw new Error("Invalid Desktop save request");
			request = id;
			flush().then(() => ({
				id,
				ok: true
			}), () => ({
				id,
				ok: false
			})).then((result) => {
				(0, node_fs.writeFileSync)(`${state}.save-result.tmp`, JSON.stringify(result));
				(0, node_fs.renameSync)(`${state}.save-result.tmp`, `${state}.save-result`);
			}).catch(report);
		} catch (error) {
			report(error);
		}
	});
	watcher.on("error", report);
	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
		try {
			schedule(event.document);
		} catch (error) {
			report(error);
		}
	}), vscode.workspace.onDidSaveTextDocument((document) => {
		try {
			schedule(document);
		} catch (error) {
			report(error);
		}
	}), vscode.workspace.onDidCloseTextDocument(cancel), vscode.workspace.onDidChangeConfiguration((event) => {
		if (event.affectsConfiguration("files.autoSave") || event.affectsConfiguration("window.confirmBeforeClose")) configureClose().catch(report);
		if (event.affectsConfiguration("rsh.autoSaveDelay")) try {
			delay();
			for (const document of vscode.workspace.textDocuments) schedule(document);
		} catch (error) {
			report(error);
		}
	}), { dispose: () => {
		watcher.close();
		for (const document of timers.keys()) cancel(document);
	} });
	for (const document of vscode.workspace.textDocuments) schedule(document);
	return flush;
}
//#endregion
//#region lib/types/ide-code-actions.js
/** User-requested code insertion and immutable previews in the Code OSS editor. */
/**
* Own proposal documents and explicit apply/discard commands.
* @param context - extension lifecycle owner.
* @param t - localized editor actions and failures.
* @returns handler for a validated user code action and its last focused editor.
*/
function installIdeCodeActions(context, t) {
	const proposals = /* @__PURE__ */ new Map();
	const currentId = () => {
		const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		return input instanceof vscode.TabInputTextDiff && input.modified.scheme === "rsh-proposal" ? input.modified.authority : void 0;
	};
	const fail = (error) => {
		vscode.window.showErrorMessage(`${t.error}: ${String(error)}`);
	};
	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider("rsh-proposal", { provideTextDocumentContent(uri) {
		const proposal = proposals.get(uri.authority);
		if (proposal === void 0) throw new Error(t.proposalExpired);
		return uri.query === "before" ? proposal.before : proposal.after;
	} }), vscode.window.tabGroups.onDidChangeTabs(({ closed }) => {
		for (const tab of closed) {
			const input = tab.input;
			if (input instanceof vscode.TabInputTextDiff && input.modified.scheme === "rsh-proposal") proposals.delete(input.modified.authority);
		}
	}), vscode.commands.registerCommand("rsh.applyCode", async () => {
		const id = currentId();
		const proposal = id === void 0 ? void 0 : proposals.get(id);
		if (proposal === void 0) return;
		try {
			if (proposal.document.isClosed || proposal.document.version !== proposal.version) throw new Error(t.proposalChanged);
			const editor = await vscode.window.showTextDocument(proposal.document, {
				viewColumn: vscode.ViewColumn.One,
				preview: false
			});
			if (proposal.document.version !== proposal.version) throw new Error(t.proposalChanged);
			if (!await editor.edit((edit) => edit.replace(proposal.range, proposal.code))) throw new Error(t.codeEditFailed);
			proposals.delete(id);
			const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((tab) => {
				const input = tab.input;
				return input instanceof vscode.TabInputTextDiff && input.modified.authority === id && input.modified.scheme === "rsh-proposal";
			});
			await vscode.window.tabGroups.close(tabs);
		} catch (error) {
			fail(error);
		}
	}), vscode.commands.registerCommand("rsh.discardCode", async () => {
		if (currentId() !== void 0) await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
	}), { dispose: () => {
		proposals.clear();
	} });
	return async (mode, code, language, active) => {
		const document = active?.document ?? await vscode.workspace.openTextDocument({
			content: "",
			...language === void 0 ? {} : { language }
		});
		const selection = active?.selection ?? new vscode.Selection(0, 0, 0, 0);
		if (mode === "insert") {
			const version = document.version;
			const editor = await vscode.window.showTextDocument(document, {
				viewColumn: vscode.ViewColumn.One,
				preview: false
			});
			if (document.version !== version) throw new Error(t.proposalChanged);
			if (!await editor.edit((edit) => edit.replace(selection, code))) throw new Error(t.codeEditFailed);
			return;
		}
		const before = document.getText();
		const range = selection.isEmpty ? new vscode.Range(document.positionAt(0), document.positionAt(before.length)) : selection;
		const after = before.slice(0, document.offsetAt(range.start)) + code + before.slice(document.offsetAt(range.end));
		const id = (0, node_crypto.randomUUID)();
		const uri = vscode.Uri.from({
			scheme: "rsh-proposal",
			authority: id,
			path: `/${document.uri.path.split("/").pop() ?? "code"}`,
			query: "before"
		});
		proposals.set(id, {
			document,
			version: document.version,
			range,
			code,
			before,
			after
		});
		try {
			await vscode.commands.executeCommand("vscode.diff", uri, uri.with({ query: "after" }), `${t.codePreview} — ${selection.isEmpty ? t.wholeFile : t.selectedCode}`, {
				viewColumn: vscode.ViewColumn.One,
				preview: false
			});
		} catch (error) {
			proposals.delete(id);
			throw error;
		}
	};
}
//#endregion
//#region lib/types/ide-extension.js
/** Code OSS extension: a retained right-side RSH AI view and workspace task navigation. */
/**
* Register workbench UI against the Desktop-supplied conversation capability.
* @param context - upstream extension owner; all contributions dispose with it.
*/
function activate(context) {
	const address = process.env.RSH_WORKBENCH_URL;
	if (address === void 0) return;
	const target = new URL(address);
	if (target.protocol !== "dsh-app:" || !target.hostname.startsWith("ide-")) throw new Error("RSH: invalid Desktop workbench address");
	const channel = target.searchParams.get("channel");
	if (channel === null) throw new Error("RSH: missing workbench channel");
	const editorState = process.env.RSH_WORKBENCH_STATE;
	if (editorState === void 0 || !(0, node_path.isAbsolute)(editorState)) throw new Error("RSH: missing Desktop editor-state file");
	const t = workbenchMessages(target.searchParams.get("locale") ?? vscode.env.language);
	const saveEditors = installIdeAutoSave(context, editorState, t);
	const codeAction = installIdeCodeActions(context, t);
	const diffDocuments = /* @__PURE__ */ new Map();
	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider("rsh-diff", { provideTextDocumentContent(uri) {
		const text = diffDocuments.get(uri.toString());
		if (text === void 0) throw new Error("RSH: change preview has expired");
		return text;
	} }), vscode.workspace.onDidCloseTextDocument((document) => {
		diffDocuments.delete(document.uri.toString());
	}), { dispose: () => {
		diffDocuments.clear();
	} });
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (folder !== void 0) target.searchParams.set("workspace", folder.uri.fsPath);
	const changes = new vscode.EventEmitter();
	let rows = [];
	let selected;
	let panel;
	let bridge;
	let ready = false;
	let workspaceId;
	let switchingWorkspace = false;
	let blockedWorkspace;
	let pending;
	let editor = vscode.window.activeTextEditor;
	const provider = {
		onDidChangeTreeData: changes.event,
		getChildren: () => [...rows],
		getTreeItem(row) {
			const item = new vscode.TreeItem(row.title);
			item.id = row.id;
			item.iconPath = new vscode.ThemeIcon(row.running ? "sync~spin" : row.id === selected ? "comment-discussion" : "comment");
			item.command = {
				command: "rsh.openTask",
				title: t.conversation,
				arguments: [row.id]
			};
			return item;
		}
	};
	const tree = vscode.window.createTreeView("rsh.tasks", { treeDataProvider: provider });
	tree.title = t.tasks;
	const send = (message) => {
		if (ready && panel !== void 0) panel.webview.postMessage({
			...message,
			channel
		});
		else pending = message;
	};
	const publishEditors = () => {
		const dirty = vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) => tab.isDirty));
		(0, node_fs.writeFileSync)(`${editorState}.tmp`, dirty ? "dirty" : "clean");
		(0, node_fs.renameSync)(`${editorState}.tmp`, editorState);
	};
	publishEditors();
	const open = () => {
		vscode.commands.executeCommand("rsh.ai.focus");
	};
	const renderView = (current) => {
		bridge?.dispose();
		current.webview.options = {
			enableScripts: true,
			localResourceRoots: []
		};
		panel = current;
		ready = false;
		const nonce = (0, node_crypto.randomBytes)(24).toString("hex");
		const source = target.href.replaceAll("&", "&amp;").replaceAll("\"", "&quot;");
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
      <\/script></body></html>`;
		bridge = current.webview.onDidReceiveMessage((value) => {
			if (typeof value !== "object" || value === null || !("channel" in value) || value.channel !== channel || !("type" in value)) return;
			if (value.type === "code-action") {
				if (!ready || switchingWorkspace || !("sessionId" in value) || value.sessionId !== selected) return;
				if (!("mode" in value) || value.mode !== "insert" && value.mode !== "preview" || !("code" in value) || typeof value.code !== "string" || "language" in value && typeof value.language !== "string") return;
				const active = editor !== void 0 && !editor.document.isClosed ? editor : void 0;
				codeAction(value.mode, value.code, "language" in value ? value.language : void 0, active).catch((error) => {
					vscode.window.showErrorMessage(`${t.error}: ${String(error)}`);
				});
			} else if (value.type === "state" && "tasks" in value && Array.isArray(value.tasks)) {
				if (!("workspace" in value) || typeof value.workspace !== "string" || !(0, node_path.isAbsolute)(value.workspace) || !("workspaceId" in value) || typeof value.workspaceId !== "string") return;
				const next = [];
				for (const row of value.tasks) {
					if (typeof row !== "object" || row === null || !("id" in row) || typeof row.id !== "string" || !("title" in row) || typeof row.title !== "string" || !("running" in row) || typeof row.running !== "boolean") return;
					next.push({
						id: row.id,
						title: row.title,
						running: row.running
					});
				}
				rows = next;
				workspaceId = value.workspaceId;
				selected = "selected" in value && typeof value.selected === "string" ? value.selected : void 0;
				current.title = rows.find((row) => row.id === selected)?.title ?? t.conversation;
				const activeFolder = vscode.workspace.workspaceFolders?.[0];
				const path = vscode.Uri.file(value.workspace).path;
				if (!(process.platform === "win32" ? activeFolder?.uri.path.toLowerCase() === path.toLowerCase() : activeFolder?.uri.path === path)) {
					ready = false;
					if (!("canSwitchWorkspace" in value) || value.canSwitchWorkspace !== true) {
						if (blockedWorkspace !== value.workspaceId) vscode.window.showWarningMessage(t.workspacePending);
						blockedWorkspace = value.workspaceId;
						return;
					}
					blockedWorkspace = void 0;
					if (switchingWorkspace) return;
					switchingWorkspace = true;
					const uri = activeFolder === void 0 ? vscode.Uri.file(value.workspace) : activeFolder.uri.with({ path });
					saveEditors().then(() => {
						if (!vscode.workspace.updateWorkspaceFolders(0, vscode.workspace.workspaceFolders?.length ?? 0, { uri })) throw new Error(t.workspaceFailed);
					}).catch((error) => {
						switchingWorkspace = false;
						vscode.window.showErrorMessage(String(error));
					});
					return;
				}
				ready = true;
				changes.fire();
				if (pending !== void 0) {
					const message = pending;
					pending = void 0;
					send(message);
				}
			} else if (value.type === "selection-rejected" && "reason" in value) vscode.window.showWarningMessage(value.reason === "busy" ? t.selectionBusy : t.selectionWorkspace);
			else if (value.type === "open-file" && "path" in value && typeof value.path === "string" && (0, node_path.isAbsolute)(value.path)) {
				if ("diffs" in value) {
					if (!Array.isArray(value.diffs) || value.diffs.length === 0) return;
					const diffs = [];
					for (const diff of value.diffs) {
						if (typeof diff !== "object" || diff === null || !("oldText" in diff) || !("newText" in diff) || diff.oldText !== null && typeof diff.oldText !== "string" || typeof diff.newText !== "string") return;
						diffs.push({
							oldText: diff.oldText,
							newText: diff.newText
						});
					}
					const name = (0, node_path.basename)(value.path);
					const show = async () => {
						for (const [index, diff] of diffs.entries()) {
							const id = (0, node_crypto.randomBytes)(16).toString("hex");
							const before = vscode.Uri.from({
								scheme: "rsh-diff",
								path: `/${id}/${name}`,
								query: "before"
							});
							const after = before.with({ query: "after" });
							diffDocuments.set(before.toString(), diff.oldText ?? "");
							diffDocuments.set(after.toString(), diff.newText);
							try {
								await vscode.commands.executeCommand("vscode.diff", before, after, `${name} — ${t.diff} ${index + 1}/${diffs.length} (${diff.oldText === null ? t.unknownBefore : t.before} → ${t.after})`, {
									viewColumn: vscode.ViewColumn.One,
									preview: false
								});
							} catch (error) {
								diffDocuments.delete(before.toString());
								diffDocuments.delete(after.toString());
								throw error;
							}
						}
					};
					show().catch((error) => {
						vscode.window.showErrorMessage(`${t.error}: ${String(error)}`);
					});
					return;
				}
				const line = "line" in value ? value.line : void 0;
				if (line !== void 0 && (typeof line !== "number" || !Number.isSafeInteger(line) || line < 1)) return;
				const path = vscode.Uri.file(value.path).path;
				const folderUri = vscode.workspace.workspaceFolders?.[0]?.uri;
				const uri = folderUri === void 0 ? vscode.Uri.file(value.path) : folderUri.with({ path });
				const position = line === void 0 ? void 0 : new vscode.Position(line - 1, 0);
				vscode.window.showTextDocument(uri, {
					viewColumn: vscode.ViewColumn.One,
					...position === void 0 ? {} : { selection: new vscode.Range(position, position) }
				}).then(void 0, (error) => {
					vscode.window.showErrorMessage(`${t.error}: ${String(error)}`);
				});
			} else if (value.type === "error" && "message" in value && typeof value.message === "string") vscode.window.showErrorMessage(`${t.error}: ${value.message}`);
		});
	};
	const returnRsh = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	returnRsh.text = `$(arrow-left) ${t.returnRsh}`;
	returnRsh.command = "rsh.return";
	returnRsh.show();
	const coding = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
	coding.text = `$(code) ${t.coding}`;
	coding.command = "rsh.coding";
	coding.show();
	const conversation = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 102);
	conversation.text = `$(comment-discussion) ${t.conversation}`;
	conversation.command = "rsh.conversation";
	conversation.show();
	const updateMode = () => {
		const chatting = panel?.visible === true;
		conversation.color = chatting ? new vscode.ThemeColor("textLink.foreground") : void 0;
		coding.color = chatting ? void 0 : new vscode.ThemeColor("textLink.foreground");
	};
	context.subscriptions.push(changes, tree, coding, conversation, returnRsh, vscode.window.registerWebviewViewProvider("rsh.ai", { resolveWebviewView(view) {
		renderView(view);
		view.onDidDispose(() => {
			bridge?.dispose();
			panel = void 0;
			ready = false;
		}, void 0, context.subscriptions);
		view.onDidChangeVisibility(updateMode, void 0, context.subscriptions);
	} }, { webviewOptions: { retainContextWhenHidden: true } }), vscode.commands.registerCommand("rsh.return", async () => {
		await saveEditors();
		open();
		send({ type: "return-rsh" });
	}), vscode.window.tabGroups.onDidChangeTabs(publishEditors), vscode.window.tabGroups.onDidChangeTabGroups(updateMode), vscode.window.onDidChangeActiveTextEditor((active) => {
		if (active !== void 0 && [
			"file",
			"vscode-remote",
			"untitled"
		].includes(active.document.uri.scheme)) editor = active;
	}), vscode.workspace.onDidChangeWorkspaceFolders(() => {
		const activeFolder = vscode.workspace.workspaceFolders?.[0];
		if (activeFolder === void 0) return;
		target.searchParams.set("workspace", activeFolder.uri.fsPath);
		switchingWorkspace = false;
		editor = void 0;
		if (panel !== void 0) renderView(panel);
		open();
	}), vscode.commands.registerTextEditorCommand("rsh.addSelection", (active) => {
		if (!ready || switchingWorkspace || workspaceId === void 0) {
			vscode.window.showWarningMessage(t.selectionWorkspace);
			return;
		}
		const chunks = active.selections.filter((selection) => !selection.isEmpty).map((selection) => {
			const text = active.document.getText(selection);
			const fence = "`".repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length + 1)));
			return `${vscode.workspace.asRelativePath(active.document.uri, false)}:${`${selection.start.line + 1}:${selection.start.character + 1}`}-${`${selection.end.line + 1}:${selection.end.character + 1}`}\n${fence}${active.document.languageId}\n${text}\n${fence}`;
		});
		if (chunks.length === 0) return;
		open();
		panel?.webview.postMessage({
			type: "selection",
			channel,
			workspaceId,
			text: chunks.join("\n\n")
		});
	}), vscode.commands.registerCommand("rsh.conversation", open), vscode.commands.registerCommand("rsh.openTask", (id) => {
		open();
		send({
			type: "select-session",
			id
		});
	}), vscode.commands.registerCommand("rsh.newTask", () => {
		open();
		send({ type: "new-session" });
	}), vscode.commands.registerCommand("rsh.coding", async () => {
		if (editor !== void 0 && !editor.document.isClosed) await vscode.window.showTextDocument(editor.document, vscode.ViewColumn.One);
		else await vscode.commands.executeCommand("workbench.action.quickOpen");
	}), { dispose: () => {
		bridge?.dispose();
	} });
	open();
}
//#endregion
exports.activate = activate;

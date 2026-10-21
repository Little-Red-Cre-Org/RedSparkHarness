/** Localized labels shared by the bundled extension manifest and runtime. */
const dictionaries = {
  en: {
    reviewTitle: 'Review code changes', reviewBlock: 'Change', reviewAccept: 'Accept', reviewAccepted: 'Accepted',
    reviewAll: 'Accept all', reviewDiscard: 'Discard remaining',
    reviewPending: 'Accept or discard pending changes before sending another request.',
    reviewConflict: 'The code changed after this preview was created. Discard it and ask AI to generate a new preview.',
    reviewSingleFile: 'The answer contains multiple code blocks. Ask AI to return one complete updated file for review.',
    reviewUnchanged: 'The proposed code is unchanged.',
    runFile: 'Run current file', stopCode: 'Stop running', runUnsupported: 'Run supports C, C++, Python, JavaScript, TypeScript and single-class Java files.',
      runBusy: 'Stop the current program before starting another.', runFailed: 'Could not run the file',
      runSaveFirst: 'Save this code file with Ctrl+S before running it.',
    runnerExecutables: 'Executable paths for single-file terminal runs. C/C++ need GCC, Java needs a JDK, TypeScript needs Node 24 or later.',
    autoSaveDelay: 'Auto-save delay in milliseconds. Integer from 100 to 10000; default 500. Each edit restarts the timer.',
    autoSaveInvalid: 'Auto-save delay must be an integer from 100 to 10000 ms.',
    saveFailed: 'Automatic saving did not finish. Check file permissions, conflicts, or choose a path for new files.',
    returnRsh: 'Return to RSH',
    invalidFileName: 'Enter a valid file name without a path.',
    renameNeedsFolder: 'Open a project folder before naming this file.', renameFailed: 'Could not create the file. Check whether the name is already in use.',
    newFile: 'New File', renameFile: 'Rename',
    conversation: 'Task conversation', tasks: 'Project tasks', coding: 'Coding', error: 'RSH workbench', newTask: 'New task',
    addSelection: 'Add selection to task', selectionBusy: 'The task input is busy. Try adding the selection again after it finishes.',
    selectionWorkspace: 'Wait for the task project to open, then add the selection again.',
    workspaceFailed: 'Could not switch the editor project. Reopen the IDE before editing this task.',
    workspacePending: 'The editor project switch is waiting. Finish the input operation and send or remove draft attachments first.',
    diff: 'Recorded change fragments', before: 'Before', after: 'After', unknownBefore: 'Previous text not recorded',
  },
  zh: {
    reviewTitle: '待确认的代码修改', reviewBlock: '修改块', reviewAccept: '采纳此块', reviewAccepted: '已采纳',
    reviewAll: '全部采纳', reviewDiscard: '放弃剩余修改',
    reviewPending: '请先采纳或放弃待确认的修改，再发送新请求。',
    reviewConflict: '中间的代码已发生变化，请放弃此预览，再让 AI 重新生成修改。',
    reviewSingleFile: '回答包含多个代码块，请让 AI 返回一个完整的修改后文件再预览。',
    reviewUnchanged: '修改后的代码与原文一致。',
    runFile: '运行当前文件', stopCode: '停止运行', runUnsupported: '支持运行 C、C++、Python、JavaScript、TypeScript 和无包声明的单类 Java 文件。',
    runBusy: '请先停止当前程序，再运行其他文件。', runFailed: '文件运行失败',
    runSaveFirst: '请先按 Ctrl+S 保存这个代码文件，再点击运行。',
    runnerExecutables: '单文件终端运行的工具路径。C/C++ 需要 GCC，Java 需要 JDK，TypeScript 需要 Node 24 或更新版本。',
    autoSaveDelay: '自动保存延迟（毫秒）。100–10000 的整数，默认 500；每次编辑重新计时。',
    autoSaveInvalid: '自动保存延迟必须是 100–10000 ms 的整数。',
    saveFailed: '自动保存未完成，请检查文件权限、内容冲突，或先为新文件选择保存路径。',
    returnRsh: '返回 RSH',
    invalidFileName: '请输入有效文件名，不要包含路径。',
    renameNeedsFolder: '请先打开项目文件夹，再为文件命名。', renameFailed: '创建文件失败，请检查是否已有同名文件。',
    newFile: '新建文件', renameFile: '重命名',
    conversation: '任务对话', tasks: '项目任务', coding: '编码', error: 'RSH 工作台', newTask: '新建任务',
    addSelection: '将选中代码加入任务', selectionBusy: '任务输入框正在处理内容，请稍后重新添加选中代码。',
    selectionWorkspace: '请等待任务项目打开后，再添加选中代码。',
    workspaceFailed: '编辑器项目切换失败，请重新打开 IDE 后再编辑此任务。',
    workspacePending: '编辑器项目切换已暂缓。请等待输入操作结束，并先发送或移除草稿附件。',
    diff: '修改记录片段', before: '修改前', after: '修改后', unknownBefore: '未记录原文',
  },
} as const

/**
 * Resolve RSH controls independently of upstream language-pack availability.
 * @param locale - Desktop locale, or the upstream locale for standalone use.
 * @returns labels for the supported locale.
 */
export function workbenchMessages(locale: string): typeof dictionaries[keyof typeof dictionaries] {
  return locale.toLowerCase().startsWith('zh') ? dictionaries.zh : dictionaries.en
}

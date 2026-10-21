/** Localized labels shared by the bundled extension manifest and runtime. */
const dictionaries = {
  en: {
    autoSaveDelay: 'Auto-save delay in milliseconds. Integer from 100 to 10000; default 500. Each edit restarts the timer.',
    autoSaveInvalid: 'Auto-save delay must be an integer from 100 to 10000 ms.',
    saveFailed: 'Automatic saving did not finish. Check file permissions, conflicts, or choose a path for new files.',
    returnRsh: 'Return to RSH',
    conversation: 'Task conversation', tasks: 'Project tasks', coding: 'Coding', error: 'RSH workbench', newTask: 'New task',
    addSelection: 'Add selection to task', selectionBusy: 'The task input is busy. Try adding the selection again after it finishes.',
    selectionWorkspace: 'Wait for the task project to open, then add the selection again.',
    workspaceFailed: 'Could not switch the editor project. Reopen the IDE before editing this task.',
    workspacePending: 'The editor project switch is waiting. Finish the input operation and send or remove draft attachments first.',
    diff: 'Recorded change fragments', before: 'Before', after: 'After', unknownBefore: 'Previous text not recorded',
  },
  zh: {
    autoSaveDelay: '自动保存延迟（毫秒）。100–10000 的整数，默认 500；每次编辑重新计时。',
    autoSaveInvalid: '自动保存延迟必须是 100–10000 ms 的整数。',
    saveFailed: '自动保存未完成，请检查文件权限、内容冲突，或先为新文件选择保存路径。',
    returnRsh: '返回 RSH',
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

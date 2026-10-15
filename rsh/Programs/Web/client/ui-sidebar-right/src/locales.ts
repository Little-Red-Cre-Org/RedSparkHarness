/** Locale keys for native Session details copy. */
export type NativeRightbarKey =
  | 'details' | 'overview' | 'activity' | 'sections' | 'session' | 'sessionId' | 'workingDirectory'
  | 'createdAt' | 'lastActive' | 'status' | 'statusBlank' | 'statusRunning' | 'statusCompleted' | 'statusIdle'
  | 'parentSession' | 'agentPreset' | 'turns' | 'userMessages' | 'assistantMessages' | 'toolCalls'
  | 'inputTokens' | 'outputTokens' | 'latestModel' | 'provider' | 'model' | 'reasoningEffort'
  | 'requestContext' | 'contextWindow' | 'activityScope' | 'loadingHistory' | 'historyUnavailable' | 'noHistory' | 'noSession' | 'close'
  | 'files' | 'filePreview' | 'filesLoading' | 'filesEmpty' | 'filesTruncated' | 'filesOther' | 'filesUnavailable'
  | 'fileFollowUnavailable' | 'noWorkspace' | 'chooseFile' | 'fileLoading' | 'fileUnavailable' | 'fileUnsupported'
  | 'reloadFiles' | 'reloadPreview' | 'loadMore' | 'fileCopy' | 'fileCopied' | 'fileFootnotes' | 'htmlPreview'
  | 'pdfPreview' | 'imagePreview'
/** Chinese native Session details copy. */
export const zh = {
  details: '会话详情', overview: '概览', activity: '活动', sections: '会话详情分类', session: '会话',
  sessionId: '会话 ID', workingDirectory: '工作目录', createdAt: '创建时间', lastActive: '最近活动',
  status: '状态', statusBlank: '新会话', statusRunning: '运行中', statusCompleted: '已完成', statusIdle: '空闲',
  parentSession: '父会话', agentPreset: 'Agent 预设', turns: '轮次', userMessages: '用户消息',
  assistantMessages: '助手消息', toolCalls: '工具调用', inputTokens: '输入 tokens', outputTokens: '输出 tokens',
  latestModel: '最近使用的模型', provider: '提供方', model: '模型', reasoningEffort: '推理强度', requestContext: '请求上下文',
  contextWindow: '上下文窗口', activityScope: '统计范围仅限 Host 返回的历史记录。',
  loadingHistory: '正在读取会话历史…', historyUnavailable: '会话历史暂不可用。',
  noHistory: '此会话还没有可统计的活动。', noSession: '请先选择会话。', close: '关闭详情',
  files: '文件', filePreview: '文件预览', filesLoading: '正在读取…', filesEmpty: '此目录为空。',
  filesTruncated: '部分条目未显示。', filesOther: '此条目无法预览。', filesUnavailable: '无法读取此文件。',
  fileFollowUnavailable: '实时文件更新暂不可用。', noWorkspace: '此会话没有工作目录。',
  chooseFile: '请在“文件”中选择一个文件进行预览。', fileLoading: '正在读取文件…',
  fileUnavailable: '无法读取或预览此文件。', fileUnsupported: '不支持此图片格式。',
  reloadFiles: '重新读取文件', reloadPreview: '重新读取预览', loadMore: '加载更多',
  fileCopy: '复制', fileCopied: '已复制', fileFootnotes: '脚注', htmlPreview: 'HTML 文档预览',
  pdfPreview: 'PDF 文档预览', imagePreview: '图片预览：{name}',
} as const satisfies Record<NativeRightbarKey, string>
/** English native Session details copy. */
export const en = {
  details: 'Session details', overview: 'Overview', activity: 'Activity', sections: 'Session detail sections', session: 'Session',
  sessionId: 'Session ID', workingDirectory: 'Working directory', createdAt: 'Created', lastActive: 'Last active',
  status: 'Status', statusBlank: 'New', statusRunning: 'Running', statusCompleted: 'Completed', statusIdle: 'Idle',
  parentSession: 'Parent Session', agentPreset: 'Agent preset', turns: 'Turns', userMessages: 'User messages',
  assistantMessages: 'Assistant messages', toolCalls: 'Tool calls', inputTokens: 'Input tokens', outputTokens: 'Output tokens',
  latestModel: 'Latest model', provider: 'Provider', model: 'Model', reasoningEffort: 'Reasoning effort', requestContext: 'Request context',
  contextWindow: 'Context window', activityScope: 'Counts reflect only the history returned by the Host.',
  loadingHistory: 'Loading Session history…', historyUnavailable: 'Session history is unavailable.',
  noHistory: 'This Session has no activity to summarize yet.', noSession: 'Select a Session first.', close: 'Close details',
  files: 'Files', filePreview: 'Preview', filesLoading: 'Loading…', filesEmpty: 'This directory is empty.',
  filesTruncated: 'Some entries are hidden.', filesOther: 'This entry cannot be previewed.', filesUnavailable: 'This file could not be read.',
  fileFollowUnavailable: 'Live file updates are unavailable.', noWorkspace: 'This Session has no workspace.',
  chooseFile: 'Select a file from Files to preview it.', fileLoading: 'Loading file…',
  fileUnavailable: 'This file could not be read or previewed.', fileUnsupported: 'This image format is not supported.',
  reloadFiles: 'Reload files', reloadPreview: 'Reload preview', loadMore: 'Load more',
  fileCopy: 'Copy', fileCopied: 'Copied', fileFootnotes: 'Footnotes', htmlPreview: 'HTML document preview',
  pdfPreview: 'PDF document preview', imagePreview: 'Image preview: {name}',
} satisfies Record<NativeRightbarKey, string>

/** Typed copy owned by the native conversation page. */
export const zh = {
  todos: '任务列表', pending: '未开始', in_progress: '进行中', completed: '已完成',
  image: '图片', images: '添加图片',
  approval: '工具审批', allow: '允许一次', deny: '拒绝', questions: '待回答问题', other: '其他回答', answer: '提交回答',
  modelControls: '模型与预设', model: '模型', reasoning: '推理强度', preset: '预设', providerDefault: 'Provider 默认',
  noPreset: '未配置预设', unavailable: '不可用', refreshModels: '刷新模型目录',
  title: 'RedSpark Harness', sessions: '会话', create: '新建会话', choose: '选择会话',
  empty: '新建或选择会话以开始对话。', prompt: '消息', send: '发送', cancel: '停止',
  loading: '正在读取会话…', ready: '就绪', sending: '正在执行…', cancelling: '正在停止并保存…',
  facts: '会话记录', user: '用户', assistant: '助手', tool: '工具', error: '请求失败',
  live: '实时助手输出', truncated: '较早的实时文本已截断；结算后的 Session 记录保持权威。',
  settled: '实时输出是临时呈现；重载后恢复结算的 Session 记录。',
} as const

/** Complete English pair for the native page's Chinese key set. */
export const en: Record<keyof typeof zh, string> = {
  todos: 'Task list', pending: 'Pending', in_progress: 'In progress', completed: 'Completed',
  image: 'Image', images: 'Add images',
  approval: 'Tool approval', allow: 'Allow once', deny: 'Reject', questions: 'Pending questions', other: 'Other answer', answer: 'Submit answer',
  modelControls: 'Model and preset', model: 'Model', reasoning: 'Reasoning effort', preset: 'Preset', providerDefault: 'Provider default',
  noPreset: 'No configured preset', unavailable: 'Unavailable', refreshModels: 'Refresh model catalog',
  title: 'RedSpark Harness', sessions: 'Sessions', create: 'New Session', choose: 'Select a Session',
  empty: 'Create or select a Session to start a conversation.', prompt: 'Message', send: 'Send', cancel: 'Stop',
  loading: 'Loading Session…', ready: 'Ready', sending: 'Running…', cancelling: 'Stopping and saving…',
  facts: 'Session records', user: 'User', assistant: 'Assistant', tool: 'Tool', error: 'Request failed',
  live: 'Live assistant output', truncated: 'Earlier live text was truncated; settled Session records remain authoritative.',
  settled: 'Live output is temporary; settled Session records restore after reload.',
}

/** Native page translation keys. */
export type ConversationLocaleKey = keyof typeof zh

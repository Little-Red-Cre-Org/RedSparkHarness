/** Typed copy owned by the native conversation page. */
export const zh = {
  title: 'RedSpark Harness', sessions: '会话', create: '新建会话', choose: '选择会话',
  empty: '新建或选择会话以开始对话。', prompt: '消息', send: '发送', cancel: '停止',
  loading: '正在读取会话…', ready: '就绪', sending: '正在执行…', cancelling: '正在停止并保存…',
  facts: '会话记录', user: '用户', assistant: '助手', tool: '工具', error: '请求失败',
  settled: '对话在执行结算后显示。',
} as const

/** Complete English pair for the native page's Chinese key set. */
export const en: Record<keyof typeof zh, string> = {
  title: 'RedSpark Harness', sessions: 'Sessions', create: 'New Session', choose: 'Select a Session',
  empty: 'Create or select a Session to start a conversation.', prompt: 'Message', send: 'Send', cancel: 'Stop',
  loading: 'Loading Session…', ready: 'Ready', sending: 'Running…', cancelling: 'Stopping and saving…',
  facts: 'Session records', user: 'User', assistant: 'Assistant', tool: 'Tool', error: 'Request failed',
  settled: 'The conversation appears after execution settles.',
}

/** Native page translation keys. */
export type ConversationLocaleKey = keyof typeof zh

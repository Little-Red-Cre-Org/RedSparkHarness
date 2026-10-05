/** Typed product text for the native interactive terminal. */
import { CHINESE_ROWS, ENGLISH_ROWS } from '@deepseek-ai/dsh-terminal-ui'

const english = {
  rows: ENGLISH_ROWS, working: 'Working', idle: 'Ready', queued: 'queued', hint: 'Enter send · Esc stop · Ctrl+C stop/exit',
  placeholder: 'Ask anything', help: '/help · /clear · /retry · /exit; Enter queues input while working.',
  noRetry: 'No input to retry.', cancelled: 'Cancelled', failed: 'Turn failed', unknownCommand: 'Unavailable command',
  closed: 'Terminal is closed.', queueFull: 'Input queue is full.',
  title: 'RedSpark', requiresTerminal: 'Native TUI requires an interactive terminal.',
}
const chinese: typeof english = {
  rows: CHINESE_ROWS, working: '运行中', idle: '就绪', queued: '排队', hint: 'Enter 发送 · Esc 停止 · Ctrl+C 停止/退出',
  placeholder: '输入问题', help: '/help · /clear · /retry · /exit；执行时 Enter 将输入排队。',
  noRetry: '没有可重试的输入。', cancelled: '已取消', failed: '轮次失败', unknownCommand: '暂不可用的命令',
  closed: '终端已关闭。', queueFull: '输入队列已满。',
  title: 'RedSpark', requiresTerminal: '原生 TUI 需要交互式终端。',
}

/** Resolve one supported terminal language.
 * @param locale - validated profile language.
 * @returns the corresponding complete product dictionary.
 */
export function terminalCopy(locale: 'en' | 'zh') { return locale === 'zh' ? chinese : english }

/** Typed product text for the native interactive terminal. */
import { CHINESE_ROWS, ENGLISH_ROWS } from '@deepseek-ai/dsh-terminal-ui'

const english = {
  rows: ENGLISH_ROWS, working: 'Working', idle: 'Ready', queued: 'queued', hint: 'Enter send · Esc stop · Ctrl+C stop/exit',
  placeholder: 'Ask anything', help: '/help · /model · /reasoning · /clear · /retry · /exit; Enter queues input while working.',
  models: 'Select model', reasoning: 'Select reasoning effort', providerDefault: 'Provider default',
  noModels: 'No models advertised by the configured Providers.',
  approval: 'Tool approval', question: 'User question', approvalHint: '/allow once · /deny · Esc cancel',
  answerHint: 'Enter option numbers (comma-separated for multiple choices), text without options, or /other text.',
  humanFull: 'Human request queue is full.', noHuman: 'No pending human request.',
  capabilities: 'Input', context: 'Context', unknown: 'Unknown', selectNumber: 'Enter a displayed number.',
  menuHint: 'Enter number to select · Esc dismiss', modelSaved: 'Model choice saved for the next turn.',
  modelBusy: 'Model controls require an idle terminal without queued input.', modelUnavailable: 'Model controls require modelSelection and modelDirectory Providers.',
  noRetry: 'No input to retry.', cancelled: 'Cancelled', failed: 'Turn failed', unknownCommand: 'Unavailable command',
  closed: 'Terminal is closed.', queueFull: 'Input queue is full.',
  title: 'RedSpark', requiresTerminal: 'Native TUI requires an interactive terminal.',
}
const chinese: typeof english = {
  rows: CHINESE_ROWS, working: '运行中', idle: '就绪', queued: '排队', hint: 'Enter 发送 · Esc 停止 · Ctrl+C 停止/退出',
  placeholder: '输入问题', help: '/help · /model · /reasoning · /clear · /retry · /exit；执行时 Enter 将输入排队。',
  models: '选择模型', reasoning: '选择推理强度', providerDefault: '提供方默认值',
  noModels: '已配置的 Provider 没有公布可选模型。',
  approval: '工具审批', question: '用户问题', approvalHint: '/allow 仅允许本次 · /deny 拒绝 · Esc 取消',
  answerHint: '输入选项编号（多选使用逗号分隔）、无选项时直接输入文本，或 /other 文本。',
  humanFull: '待回答的人机请求队列已满。', noHuman: '没有待回答的人机请求。',
  capabilities: '输入', context: '上下文', unknown: '未知', selectNumber: '请输入展示的编号。',
  menuHint: '输入编号选择 · Esc 关闭', modelSaved: '模型选择已保存，将用于下一轮。',
  modelBusy: '模型控制要求终端空闲且没有排队输入。', modelUnavailable: '模型控制需要 modelSelection 与 modelDirectory Provider。',
  noRetry: '没有可重试的输入。', cancelled: '已取消', failed: '轮次失败', unknownCommand: '暂不可用的命令',
  closed: '终端已关闭。', queueFull: '输入队列已满。',
  title: 'RedSpark', requiresTerminal: '原生 TUI 需要交互式终端。',
}

/** Resolve one supported terminal language.
 * @param locale - validated profile language.
 * @returns the corresponding complete product dictionary.
 */
export function terminalCopy(locale: 'en' | 'zh') { return locale === 'zh' ? chinese : english }

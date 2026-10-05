/** Product text used by the shared transcript rows. */
export interface TerminalRowCopy {
  readonly thinking: string
  readonly running: string
  readonly waitingReasoning: string
  readonly noReasoning: string
  readonly tool: string
  readonly unknown: string
  /** @param count - omitted output lines. @returns localized preview footer. */
  omitted(count: number): string
  /** @param code - tool error identifier. @returns localized tool failure label. */
  error(code: string): string
}

/** English transcript labels retain the compatibility presentation. */
export const ENGLISH_ROWS: TerminalRowCopy = {
  thinking: '  thinking', running: 'Running ', waitingReasoning: '    waiting for provider reasoning stream…',
  noReasoning: '    provider did not send a reasoning stream', tool: 'tool', unknown: 'unknown',
  omitted: count => `    … +${count} lines`, error: code => `    error: ${code}`,
}

/** Chinese transcript labels selected by the native terminal locale. */
export const CHINESE_ROWS: TerminalRowCopy = {
  thinking: '  思考', running: '运行 ', waitingReasoning: '    等待模型推理流…',
  noReasoning: '    模型未发送推理流', tool: '工具', unknown: '未知',
  omitted: count => `    … 省略 ${count} 行`, error: code => `    错误：${code}`,
}

/** Ink input and existing transcript rows over a narrow owned interaction port. */
import React, { useEffect, useState } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import TextInput from 'ink-text-input'
import { ChatRow, StreamBlock, stripAnsi } from '@deepseek-ai/dsh-terminal-ui'
import { createUserMessage, type UserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm/native'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { terminalCopy } from './locale.ts'
import type { TerminalModelState } from './models.ts'
import type { ModelSelection } from '@deepseek-ai/dsh-native-model-execution/model-selection'
import type { NativeModelSelectionRequest } from '@deepseek-ai/dsh-native-model-selection/types'
import type { TerminalHumanPrompt } from './human.ts'

/** Renderer state; completed rows originate in the durable Session log. */
export interface TerminalState {
  readonly events: readonly SessionEvent[]
  readonly chunks: readonly StreamChunk[]
  readonly busy: boolean
  readonly queued: number
  readonly error?: string | undefined
  readonly model?: TerminalModelState | undefined
  readonly choice?: ModelSelection | null | undefined
  readonly human?: TerminalHumanPrompt | undefined
}

/** An application-owned input queue, without transferable Agent or writer objects. */
export interface TerminalInteraction {
  /** @returns the current immutable renderer observation. */
  snapshot(): TerminalState
  /**
   * @param listener - renderer notification.
   * @returns disposal withdrawing this listener.
   */
  subscribe(listener: () => void): () => void
  /** @param message - identified user input admitted to the queue. */
  submit(message: UserMessage): void
  /** Cancel the active turn and discard queued input. */
  cancel(): void
  /** Request exit after accepted execution cleanup. */
  exit(): void
  /** @returns current durable choice and Provider-owned model metadata. */
  models(): Promise<TerminalModelState>
  /**
   * @param request - complete choice and observed revision.
   * @returns accepted durable choice and metadata.
   */
  selectModel(request: NativeModelSelectionRequest): Promise<TerminalModelState>
  /**
   * @param value - entered response to the currently displayed human request.
   * @param expected - exact rendered request; stale responses refuse.
   */
  answerHuman(value: string, expected: TerminalHumanPrompt): void
}

/** Render the input composer and the shared safe transcript rows.
 * @param props - narrow application interaction and locale.
 * @returns the Ink tree; it owns no execution or persistence.
 */
export function TerminalView({ interaction, locale, model, background }: {
  interaction: TerminalInteraction
  locale: 'en' | 'zh'
  model: ModelSelection
  background: string
}): React.ReactElement {
  const copy = terminalCopy(locale)
  const [state, setState] = useState(interaction.snapshot())
  const [input, setInput] = useState('')
  const [notice, setNotice] = useState('')
  const [last, setLast] = useState('')
  const [first, setFirst] = useState(-1)
  const [menu, setMenu] = useState<{
    title: string
    labels: readonly string[]
    choices: readonly ModelSelection[]
    observed: TerminalModelState
  }>()
  const { stdout } = useStdout()
  useEffect(() => interaction.subscribe(() => { setState(interaction.snapshot()) }), [interaction])
  useInput((keyInput, key) => {
    if (key.ctrl && keyInput === 'c') { if (state.busy) interaction.cancel(); else interaction.exit() }
    if (key.escape && menu !== undefined) { setMenu(undefined); setNotice(''); return }
    if (key.escape && state.busy) {
      interaction.cancel()
      if (input.trim() !== '') { submit(input); setInput('') }
    }
  })
  const submit = (value: string): void => {
    const text = value.trim()
    if (text === '') return
    if (text === '/exit' || text === '/quit') { interaction.exit(); return }
    if (state.human !== undefined) {
      try { interaction.answerHuman(text, state.human); setNotice('') } catch (error: unknown) { setNotice(String(error)) }
      return
    }
    if (menu !== undefined) {
      const index = Number(text) - 1
      const selected = Number.isSafeInteger(index) && index >= 0 ? menu.choices[index] : undefined
      if (selected === undefined) { setNotice(copy.selectNumber); return }
      void interaction.selectModel({ selected, expectedRevision: menu.observed.state.revision }).then(() => {
        setMenu(undefined); setNotice(copy.modelSaved)
      }, (error: unknown) => { setMenu(undefined); setNotice(String(error)) })
      return
    }
    if (text === '/model' || text === '/reasoning') {
      void interaction.models().then((observed) => {
        const selected = observed.state.next ?? model
        const choices = text === '/model' ? observed.catalog.groups.flatMap(group => group.models.map(entry => ({ provider: group.id, model: entry.id })))
          : [{ provider: selected.provider, model: selected.model },
            ...(observed.resolved.reasoning?.efforts.map(effort => ({ ...selected, reasoningEffort: String(effort.id) })) ?? [])]
        const labels = text === '/model' ? observed.catalog.groups.flatMap(group => group.models.map(entry => `${group.name} / ${entry.name} (${entry.id})`))
          : [copy.providerDefault, ...(observed.resolved.reasoning?.efforts.map(effort => effort.name) ?? [])]
        setMenu(choices.length === 0 ? undefined : { title: text === '/model' ? copy.models : copy.reasoning, labels, choices, observed })
        setNotice([...(choices.length === 0 ? [copy.noModels] : []),
          ...observed.catalog.failures.map(failure => `${failure.name}: ${failure.message}`)].join('\n'))
      }, (error: unknown) => { setNotice(String(error)) })
      return
    }
    if (text === '/help') { setNotice(copy.help); return }
    if (text === '/clear') { setFirst(state.events.at(-1)?.seq ?? -1); setNotice(''); return }
    if (text === '/retry') { if (last === '') setNotice(copy.noRetry); else send(last); return }
    if (text.startsWith('/')) { setNotice(`${copy.unknownCommand}: ${text}`); return }
    send(text)
  }
  const send = (text: string): void => {
    setLast(text)
    setNotice('')
    // The shared LLM constructor creates the same identified user input as other Programs.
    try { interaction.submit(createInput(text)) } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }
  const width = Math.max(20, stdout.columns - 2)
  const choice = state.choice ?? model
  const observed = state.model?.resolved
  const info = observed?.provider === choice.provider && observed.id === choice.model ? observed : undefined
  const effort = choice.reasoningEffort ?? info?.reasoning?.defaultEffort
  const calls = new Map(state.events.flatMap(event => event.type === 'assistant/message'
    ? event.data.message.content.filter(block => block.type === 'tool-call').map(block => [block.id, block] as const) : []))
  const rows = state.events.filter(event => event.seq > first).flatMap<Record<string, unknown>>((event) => {
    if (event.type === 'user/message') return [{ kind: 'user', text: messageText(event.data.content) }]
    if (event.type === 'assistant/message') return [{ kind: 'assistant', text: messageText(event.data.message.content),
      reasoning: event.data.message.content.filter(block => block.type === 'reasoning').map(block => block.text).join(''), usage: event.data.usage }]
    if (event.type === 'tool/result') {
      const block = event.data.message.content[0]
      return [{ kind: 'tool', name: calls.get(event.data.message.source.callId)?.name ?? copy.rows.tool,
        args: calls.get(event.data.message.source.callId)?.arguments ?? '', status: block.isError ? 'error' : 'done',
        output: messageText(block.content), seconds: undefined }]
    }
    return []
  })
  const stream = { text: '', reasoning: '', tool: null as { name: string; args: string } | null }
  for (const chunk of state.chunks) {
    if (chunk.type === 'text-delta') stream.text += chunk.text
    if (chunk.type === 'reasoning-delta') stream.reasoning += chunk.text
  }
  return React.createElement(Box, { flexDirection: 'column' },
    React.createElement(Text, { bold: true }, `${copy.title} · ${stripAnsi(`${choice.provider}/${choice.model}${effort === undefined ? '' : ' · ' + effort}`)}`),
    info === undefined ? null : React.createElement(Text, { dimColor: true }, stripAnsi(`${copy.capabilities}: ${info.inputModalities?.join(', ') ?? copy.unknown}; ${copy.context}: ${info.context?.contextWindow ?? copy.unknown}`)),
    ...rows.slice(-Math.max(1, stdout.rows - 8)).map((item, index) => React.createElement(ChatRow, {
      key: index, item, width, themeBg: background, copy: copy.rows,
    })),
    React.createElement(StreamBlock, { stream, width, themeBg: background, busy: state.busy, copy: copy.rows }),
    React.createElement(Text, { dimColor: true }, `${state.busy ? copy.working : copy.idle} · ${state.queued} ${copy.queued}`),
    notice === '' ? null : React.createElement(Text, {}, stripAnsi(notice)),
    state.error === undefined ? null : React.createElement(Text, { color: 'red' }, stripAnsi(state.error)),
    state.human === undefined ? null : React.createElement(Box, { flexDirection: 'column' },
      React.createElement(Text, { bold: true }, state.human.kind === 'approval' ? copy.approval : copy.question),
      React.createElement(Text, {}, stripAnsi(state.human.kind === 'approval'
        ? `${state.human.toolName}${state.human.reason === undefined ? '' : '\n' + state.human.reason}`
        : `${state.human.question.header === undefined ? '' : state.human.question.header + '\n'}${state.human.question.question}${state.human.question.detail === undefined ? '' : '\n' + state.human.question.detail}`)),
      ...(state.human.kind === 'question' ? state.human.question.options?.map((option, index) => React.createElement(Text, { key: index },
        stripAnsi(`${index + 1}. ${option.label}${option.description === undefined ? '' : ' — ' + option.description}`))) ?? [] : []),
      React.createElement(Text, { dimColor: true }, state.human.kind === 'approval' ? copy.approvalHint : copy.answerHint)),
    menu === undefined ? null : React.createElement(Box, { flexDirection: 'column' },
      React.createElement(Text, { bold: true }, menu.title),
      ...menu.labels.map((label, index) => React.createElement(Text, { key: index }, stripAnsi(`${index + 1}. ${label}`))),
      React.createElement(Text, { dimColor: true }, copy.menuHint)),
    React.createElement(TextInput, { value: input, onChange: setInput, placeholder: copy.placeholder,
      onSubmit: (value: string) => { submit(value); setInput('') } }),
    React.createElement(Text, { dimColor: true }, copy.hint),
  )
}

function createInput(text: string): UserMessage { return createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }) }
function messageText(blocks: readonly { readonly type: string; readonly text?: string }[]): string {
  return blocks.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

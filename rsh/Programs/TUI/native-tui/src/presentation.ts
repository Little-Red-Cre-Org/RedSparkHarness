/** Ink input and existing transcript rows over a narrow owned interaction port. */
import React, { useEffect, useState } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import TextInput from 'ink-text-input'
import { ChatRow, StreamBlock, computeViewport, stripAnsi } from '@deepseek-ai/dsh-terminal-ui'
import { createUserMessage, type UserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm/native'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { terminalCopy } from './locale.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TerminalModelState } from './models.ts'
import type { ModelSelection } from '@deepseek-ai/dsh-native-model-execution/model-selection'
import type { NativeModelSelectionRequest } from '@deepseek-ai/dsh-native-model-selection/types'
import type { TerminalHumanPrompt } from './human.ts'
import type { TerminalPresetState } from './presets.ts'
import type { NativeAgentPresetSelectionRequest } from '@deepseek-ai/dsh-agent-presets/selection'
import type { CommandDescriptor, CommandExecution } from '@deepseek-ai/dsh-commands/native'
import { parseCommand } from '@deepseek-ai/dsh-commands/native'

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
  readonly preset?: TerminalPresetState | undefined
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
  /** @returns stored Session identities in the configured workspace. */
  sessions(): Promise<readonly SessionId[]>
  /** @param id - selected stored Session. @returns completion of exclusive restore and transcript replacement. */
  selectSession(id: SessionId): Promise<void>
  /** @returns installed composition metadata and complete durable choice facts. */
  presets(): Promise<TerminalPresetState>
  /** @param request - installed composition and observed revision. @returns committed blank-Session selection. */
  selectPreset(request: Omit<NativeAgentPresetSelectionRequest, 'id'>): Promise<TerminalPresetState>
  /** @returns command names visible to the selected Agent. */
  commands(): Promise<readonly CommandDescriptor[]>
  /** @param line - complete human command input. @returns settled command result or undefined when unavailable. */
  dispatchCommand(line: string): Promise<CommandExecution | undefined>
  /**
   * @param value - entered response to the currently displayed human request.
   * @param expected - exact rendered request; stale responses refuse.
   */
  answerHuman(value: string, expected: TerminalHumanPrompt): void
}

const localCommands = new Set(['help', 'sessions', 'mode', 'model', 'reasoning', 'clear', 'retry', 'exit', 'quit'])

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
  const [scrollLines, setScrollLines] = useState(0)
  const [sessionMenu, setSessionMenu] = useState<readonly SessionId[]>()
  const [presetMenu, setPresetMenu] = useState<TerminalPresetState>()
  const [menu, setMenu] = useState<{
    title: string
    labels: readonly string[]
    choices: readonly ModelSelection[]
    observed: TerminalModelState
  }>()
  const { stdout } = useStdout()
  useEffect(() => interaction.subscribe(() => { setState(interaction.snapshot()) }), [interaction])
  useEffect(() => {
    if (state.human === undefined || menu === undefined && sessionMenu === undefined && presetMenu === undefined) return
    setMenu(undefined); setSessionMenu(undefined); setPresetMenu(undefined); setInput(''); setNotice(copy.menuInterrupted)
  }, [state.human, menu, sessionMenu, presetMenu, copy.menuInterrupted])
  useInput((keyInput, key) => {
    if (key.pageUp || key.pageDown) {
      setScrollLines(Math.min(viewport.maxScroll, Math.max(0, viewport.scrollLines + (key.pageUp ? viewport.step : -viewport.step))))
      return
    }
    if (key.ctrl && keyInput === 'c') { if (state.busy) interaction.cancel(); else interaction.exit() }
    if (key.escape && menu !== undefined) { setMenu(undefined); setNotice(''); return }
    if (key.escape && sessionMenu !== undefined) { setSessionMenu(undefined); setNotice(''); return }
    if (key.escape && presetMenu !== undefined) { setPresetMenu(undefined); setNotice(''); return }
    if (key.escape && state.human !== undefined) { interaction.cancel(); setNotice(''); return }
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
      if (menu !== undefined || sessionMenu !== undefined || presetMenu !== undefined) {
        setMenu(undefined); setSessionMenu(undefined); setPresetMenu(undefined); setNotice(copy.menuInterrupted)
        return
      }
      try { interaction.answerHuman(text, state.human); setNotice('') } catch (error: unknown) { setNotice(String(error)) }
      return
    }
    if (presetMenu !== undefined) {
      const index = Number(text) - 1
      const selected = Number.isSafeInteger(index) && index >= 0 ? presetMenu.entries[index] : undefined
      if (selected === undefined) { setNotice(copy.selectNumber); return }
      void interaction.selectPreset({ preset: selected.id, expectedRevision: presetMenu.facts.revision }).then(() => {
        setPresetMenu(undefined); setNotice(copy.presetSaved)
      }, (error: unknown) => { setPresetMenu(undefined); setNotice(String(error)) })
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
    if (sessionMenu !== undefined) {
      const index = Number(text) - 1
      const id = Number.isSafeInteger(index) && index >= 0 ? sessionMenu[index] : undefined
      if (id === undefined) { setNotice(copy.selectNumber); return }
      void interaction.selectSession(id).then(() => {
        setSessionMenu(undefined); setFirst(-1); setScrollLines(0); setLast(''); setNotice(copy.sessionOpened)
      }, (error: unknown) => { setSessionMenu(undefined); setNotice(String(error)) })
      return
    }
    if (text === '/mode') {
      void interaction.presets().then((observed) => {
        if (interaction.snapshot().human !== undefined) { setNotice(copy.menuInterrupted); return }
        if (observed.facts.locked) { setNotice(copy.presetLocked); return }
        setPresetMenu(observed.entries.length === 0 ? undefined : observed)
        setNotice(observed.entries.length === 0 ? copy.noPresets : '')
      }, (error: unknown) => { setNotice(String(error)) })
      return
    }
    if (text === '/sessions') {
      void interaction.sessions().then((sessions) => {
        if (interaction.snapshot().human !== undefined) { setNotice(copy.menuInterrupted); return }
        setSessionMenu(sessions.length === 0 ? undefined : sessions)
        setNotice(sessions.length === 0 ? copy.noSessions : '')
      }, (error: unknown) => { setNotice(String(error)) })
      return
    }
    if (text === '/model' || text === '/reasoning') {
      void interaction.models().then((observed) => {
        if (interaction.snapshot().human !== undefined) { setNotice(copy.menuInterrupted); return }
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
    if (text === '/help') {
      void interaction.commands().then((commands) => {
        const contributed = commands.filter(command => !localCommands.has(command.name)).map(command =>
          `/${command.name}${command.input?.hint === undefined ? '' : ' ' + command.input.hint} — ${command.description}`)
        setNotice([copy.help, contributed.length === 0 ? copy.noCommands : `${copy.commandsAvailable}\n${contributed.join('\n')}`].join('\n'))
      }, (error: unknown) => { setNotice(`${copy.help}\n${String(error)}`) })
      return
    }
    if (text === '/clear') { setFirst(state.events.at(-1)?.seq ?? -1); setScrollLines(0); setNotice(''); return }
    if (text === '/retry') { if (last === '') setNotice(copy.noRetry); else send(last); return }
    const parsedCommand = parseCommand(text)
    if (parsedCommand !== undefined && localCommands.has(parsedCommand.name) && parsedCommand.rawInput.trim() !== '') {
      setNotice(copy.localCommandArguments)
      return
    }
    if (text.startsWith('/')) {
      void interaction.dispatchCommand(value).then((execution) => {
        setNotice(execution?.result.text ?? (execution === undefined ? `${copy.unknownCommand}: ${text}` : copy.commandCompleted))
      }, (error: unknown) => { setNotice(String(error)) })
      return
    }
    send(text)
  }
  const send = (text: string): void => {
    setScrollLines(0)
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
  const viewport = computeViewport({ items: rows, rows: stdout.rows - 6, width, scrollLines, busy: state.busy })
  for (const chunk of state.chunks) {
    if (chunk.type === 'text-delta') stream.text += chunk.text
    if (chunk.type === 'reasoning-delta') stream.reasoning += chunk.text
  }
  return React.createElement(Box, { flexDirection: 'column' },
    React.createElement(Text, { bold: true }, `${copy.title} · ${stripAnsi(`${choice.provider}/${choice.model}${effort === undefined ? '' : ' · ' + effort}`)}`),
    info === undefined ? null : React.createElement(Text, { dimColor: true }, stripAnsi(`${copy.capabilities}: ${info.inputModalities?.join(', ') ?? copy.unknown}; ${copy.context}: ${info.context?.contextWindow ?? copy.unknown}`)),
    ...viewport.visible.map((item, index) => React.createElement(ChatRow, {
      key: index, item, width, themeBg: background, copy: copy.rows,
    })),
    React.createElement(StreamBlock, { stream, width, themeBg: background, busy: state.busy, copy: copy.rows }),
    React.createElement(Text, { dimColor: true }, `${state.busy ? copy.working : copy.idle} · ${state.queued} ${copy.queued}`),
    viewport.atBottom ? null : React.createElement(Text, { dimColor: true }, `${copy.history}: ${viewport.scrollLines} · ${copy.scrollHint}`),
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
    sessionMenu === undefined ? null : React.createElement(Box, { flexDirection: 'column' },
      React.createElement(Text, { bold: true }, copy.sessions),
      ...sessionMenu.map((id, index) => React.createElement(Text, { key: id }, stripAnsi(`${index + 1}. ${id}`))),
      React.createElement(Text, { dimColor: true }, copy.menuHint)),
    presetMenu === undefined ? null : React.createElement(Box, { flexDirection: 'column' },
      React.createElement(Text, { bold: true }, copy.presets),
      ...presetMenu.entries.map((preset, index) => React.createElement(Text, { key: preset.id }, stripAnsi(`${index + 1}. ${preset.name} (${preset.id})`))),
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

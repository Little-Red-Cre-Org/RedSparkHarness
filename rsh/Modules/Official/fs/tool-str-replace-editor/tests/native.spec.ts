/** Native str_replace_editor registration over a real local filesystem. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@redspark/rsh-native-runtime'
import { NativeAgentId, type NativeAgentRegistry } from '@redspark/rsh-native-agent'
import { plugin as agentPlugin } from '@redspark/rsh-native-agent/native'
import { plugin as toolsPlugin } from '@redspark/rsh-native-tools/native'
import type { NativeToolRegistry } from '@redspark/rsh-native-tools'
import { FsError } from '@redspark/rsh-fs/native'
import { localFilesystemPlugin } from '@redspark/rsh-fs-local/native'
import { plugin as observationPlugin } from '@redspark/rsh-fs-observation-policy/native'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@redspark/rsh-session/native'
import { ToolCallId } from '@redspark/rsh-llm/native'
import { plugin } from '../src/native.ts'

it('rejects editor configuration outside the Cordis limits', () => {
  expect(() => plugin.resolve(null)).toThrow('configuration must be an object')
  expect(() => plugin.resolve([])).toThrow('configuration must be an object')
  expect(() => plugin.resolve('editor')).toThrow('configuration must be an object')
  expect(() => plugin.resolve({ extra: true })).toThrow('unknown configuration field extra')
  expect(() => plugin.resolve({ maxOutputChars: 0 })).toThrow('maxOutputChars must be a positive safe integer')
  expect(() => plugin.resolve({ maxOutputChars: 1.5 })).toThrow('maxOutputChars must be a positive safe integer')
  expect(() => plugin.resolve({ maxOutputChars: '16000' })).toThrow('maxOutputChars must be a positive safe integer')
  expect(() => plugin.resolve({ description: ' ' })).toThrow('description must be non-empty')
  expect(() => plugin.resolve({ description: '' })).toThrow('description must be non-empty')
  expect(() => plugin.resolve({ description: 1 })).toThrow('description must be non-empty')
  expect(() => plugin.resolve(undefined)).not.toThrow()
  expect(() => plugin.resolve({})).not.toThrow()
  expect(() => plugin.resolve({ maxOutputChars: 32 })).not.toThrow()
  expect(() => plugin.resolve({ description: 'custom editor' })).not.toThrow()
})

it('requires sandbox policy only when the mounted filesystem confines', () => {
  const registered: { schema: { name: string } }[] = []
  const install = plugin.resolve({}) as (context: {
    require: (name: string) => unknown
    optional: (name: string) => unknown
    effect: (disposer: unknown) => unknown
    scope: object
  }) => void
  const confined = {
    require: (name: string) => {
      if (name === 'fs') return { sandboxMode: 'read-only' }
      if (name === 'fsObservationPolicy') return { kind: 'observed-state' }
      return { registerValueTool: (tool: { schema: { name: string } }) => { registered.push(tool); return async () => {} } }
    },
    optional: () => {
      return undefined
    },
    effect: (disposer: unknown) => disposer,
    scope: {},
  }
  expect(() => {
    install(confined)
  }).toThrow('ctx.sandboxPolicy is missing')
  install({
    ...confined,
    optional: () => ({ resolve: () => ({ mode: 'read-only', workspaceRoot: '/' }) }),
  })
  expect(registered.map(tool => tool.schema.name)).toEqual(['str_replace_editor'])
})

it('views, creates, replaces uniquely, rejects an ambiguous replace, and inserts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rsh-native-str-replace-editor-'))
  const scope = new NativeScope()
  let agents!: NativeAgentRegistry
  let tools!: NativeToolRegistry
  const capture: NativePlugin = {
    apiVersion: 1,
    name: 'editor-test-capture',
    targets: ['host'],
    requires: ['tools', 'agents'],
    provides: [],
    resolve: () => (context) => {
      agents = context.require('agents')
      tools = context.require('tools')
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: localFilesystemPlugin, scope, config: { cwd: root } },
    { plugin: observationPlugin, scope, config: undefined },
    { plugin: agentPlugin, scope, config: undefined },
    { plugin: toolsPlugin, scope, config: undefined },
    { plugin, scope, config: { maxOutputChars: 16_000, description: 'native editor' } },
    { plugin: capture, scope, config: undefined },
  ], 'host'))
  const agent = { id: NativeAgentId('str-replace-editor'), scope }
  try {
    await host.start()
    const registered = agents.register(agent)
    const id = SessionId('native-str-replace-editor')
    const session = Session.create(id, undefined, {
      version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false, cwd: root,
    })
    let callNumber = 0
    const call = (args: unknown) => tools.execute({
      agent,
      session,
      callId: ToolCallId(`native-editor-${++callNumber}`),
      name: 'str_replace_editor',
      arguments: args,
      signal: new AbortController().signal,
      appendEvent: async (type, data, ...opts) => session.append(type, data, ...opts),
    })
    const text = (result: { content: readonly { type: string; text?: string }[] }): string =>
      result.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
    const sample = join(root, 'sample.txt')
    expect(text(await call({
      command: 'create', path: sample, file_text: 'one\ntwo\nthree\n',
      insert_line: null, new_str: null, old_str: null, view_range: null,
    }))).toBe(`New file created successfully at: ${sample}`)
    expect(text(await call({ command: 'view', path: sample, view_range: null }))).toContain('     2  two')
    expect(text(await call({
      command: 'str_replace', path: sample, old_str: 'two', new_str: 'TWO',
    }))).toBe(`The file ${sample} has been edited successfully.`)
    expect(text(await call({
      command: 'insert', path: sample, insert_line: 1, new_str: 'between',
    }))).toBe(`The file ${sample} has been edited successfully.`)
    expect(await readFile(sample, 'utf8')).toBe('one\nbetween\nTWO\nthree\n')

    const ambiguous = join(root, 'ambiguous.txt')
    await call({ command: 'create', path: ambiguous, file_text: 'same\nother\nsame' })
    await expect(call({
      command: 'str_replace', path: ambiguous, old_str: 'same', new_str: 'x',
    })).rejects.toThrow('Multiple occurrences of old_str `same` in lines [1, 3]')
    expect(await readFile(ambiguous, 'utf8')).toBe('same\nother\nsame')
    await registered()
  } finally {
    await host.stop()
    await rm(root, { recursive: true, force: true })
  }
})

it('preserves filesystem errors that are not sandbox denials', async () => {
  const registered: { execute: (call: unknown) => Promise<unknown> }[] = []
  const install = plugin.resolve({ description: 'native editor' }) as unknown as (context: {
    require: (name: string) => unknown
    optional: (name: string) => unknown
    effect: (disposer: unknown) => unknown
    scope: object
    events: {
      waterfall: (_scope: object, _key: string, terminal: () => unknown, ...args: unknown[]) => Promise<unknown>
      emit: () => void
    }
  }) => void
  const scope = {}
  install({
    require: (name: string) => {
      if (name === 'fs') {
        return {
          sandboxMode: undefined,
          resolve: async (path: string) => ({ displayPath: path, targetKey: path }),
          stat: async () => undefined,
          writeText: async () => { throw new FsError('disk full', 'FS_IO_ERROR') },
        }
      }
      if (name === 'fsObservationPolicy') return { kind: 'observed-state' }
      return {
        registerValueTool: (tool: { execute: (call: unknown) => Promise<unknown> }) => {
          registered.push(tool)
          return async () => {}
        },
      }
    },
    optional: () => {
      return undefined
    },
    effect: (disposer: unknown) => disposer,
    scope,
    events: {
      waterfall: async (_scope, _key, terminal) => terminal(),
      emit: () => {},
    },
  })
  const tool = registered[0]
  if (tool === undefined) throw new Error('missing editor registration')
  const call = {
    signal: new AbortController().signal,
    session: {},
  }
  await expect(tool.execute({
    ...call,
    arguments: { command: 'create', path: '/tmp/native-editor.txt', file_text: 'x' },
  })).rejects.toMatchObject({ code: 'FS_IO_ERROR', message: 'disk full' })
  await expect(tool.execute({
    ...call,
    arguments: { command: 'str_replace', path: '/tmp/native-editor.txt', old_str: 'a', new_str: 'b' },
  })).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
})

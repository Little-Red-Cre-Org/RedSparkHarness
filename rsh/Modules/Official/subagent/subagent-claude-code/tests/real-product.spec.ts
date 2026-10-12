import { execFile } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type {
  Query,
  SDKMessage,
  SDKSystemMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { Context } from '@deepseek-ai/cordis'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { NativeContext } from '@deepseek-ai/dsh-native-runtime'
import type { NativeExternalSubagentDriver, NativeExternalSubagentRequest } from '@deepseek-ai/dsh-native-subagent/native'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as claudeCode from '../src/index.ts'
import { plugin as nativeClaudeCode } from '../src/native.ts'
import type { ClaudeCodePermissionMode } from '../src/run.ts'
import {
  startMessagesFixture,
  type MessagesBehavior,
  type MessagesFixture,
} from './messages-fixture.ts'

const observedSdkMessages = vi.hoisted((): SDKMessage[] => [])
const sdkTestOverrides = vi.hoisted((): { maxTurns?: number } => ({}))

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@anthropic-ai/claude-agent-sdk')
  >()
  return {
    ...actual,
    query(params: Parameters<typeof actual.query>[0]): Query {
      const query = actual.query(sdkTestOverrides.maxTurns === undefined
        ? params
        : {
          ...params,
          options: { ...params.options, maxTurns: sdkTestOverrides.maxTurns },
        })
      // Observe the real SDK stream without replacing its protocol or CLI.
      return new Proxy(query, {
        get(target, property) {
          if (property === Symbol.asyncIterator) {
            return async function* (): AsyncGenerator<SDKMessage, void> {
              for await (const message of target) {
                observedSdkMessages.push(message)
                yield message
              }
            }
          }
          const value: unknown = Reflect.get(target, property, target)
          if (typeof value === 'function') {
            const method = value as (...args: unknown[]) => unknown
            return method.bind(target)
          }
          return value
        },
      })
    },
  }
})

const execFileAsync = promisify(execFile)
const sdkRoot = dirname(fileURLToPath(
  import.meta.resolve('@anthropic-ai/claude-agent-sdk'),
))
const sdkPackage = JSON.parse(readFileSync(
  join(sdkRoot, 'package.json'),
  'utf8',
)) as {
  version: string
  claudeCodeVersion: string
  optionalDependencies: Record<string, string>
}
const platformPackage = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`
const platformRoot = resolve(sdkRoot, '..', platformPackage.split('/')[1]!)
const claudeBin = join(
  platformRoot,
  process.platform === 'win32' ? 'claude.exe' : 'claude',
)
const settingsModel = 'dsh-settings-inheritance-marker'
const fakeKey = 'dsh-fake-anthropic-key'

const roots: string[] = []
const fixtures: MessagesFixture[] = []
const contexts: Context[] = []

// Ambient Anthropic model env leaks into the real CLI and overrides the
// fixture settings.json on developer machines; delete it for this file and
// restore it after, like the workspace-context USERPROFILE isolation.
const ambientAnthropicModel = process.env.ANTHROPIC_MODEL
const ambientAnthropicSmallFastModel = process.env.ANTHROPIC_SMALL_FAST_MODEL

beforeAll(() => {
  delete process.env.ANTHROPIC_MODEL
  delete process.env.ANTHROPIC_SMALL_FAST_MODEL
})

afterAll(() => {
  if (ambientAnthropicModel !== undefined) process.env.ANTHROPIC_MODEL = ambientAnthropicModel
  if (ambientAnthropicSmallFastModel !== undefined) process.env.ANTHROPIC_SMALL_FAST_MODEL = ambientAnthropicSmallFastModel
})

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(fixtures.splice(0).map(fixture => fixture.close()))
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
  observedSdkMessages.length = 0
  delete sdkTestOverrides.maxTurns
})

interface RealHarness {
  readonly ctx: Context
  readonly handles: SubprocessHandle[]
  readonly spawnSpecs: SubprocessSpawnSpec[]
  readonly parent: Agent
  readonly workspace: string
  readonly env: Record<string, string>
}

interface RealInstanceFixture {
  readonly fixture: MessagesFixture
  readonly workspace: string
  readonly env: Record<string, string>
}

async function realInstanceFixture(
  behavior: MessagesBehavior,
  nativeAllow: readonly string[] = [],
): Promise<RealInstanceFixture> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-claude-code-real-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  const claudeConfig = join(root, 'claude-config')
  const xdgConfig = join(root, 'xdg')
  mkdirSync(workspace)
  mkdirSync(claudeConfig)
  mkdirSync(xdgConfig)
  writeFileSync(
    join(claudeConfig, 'settings.json'),
    `${JSON.stringify({
      model: settingsModel,
      permissions: {
        defaultMode: 'default',
        ...nativeAllow.length === 0 ? {} : { allow: nativeAllow },
      },
    }, null, 2)}\n`,
  )
  const fixture = await startMessagesFixture(behavior)
  fixtures.push(fixture)
  const env = {
    ANTHROPIC_API_KEY: fakeKey,
    ANTHROPIC_BASE_URL: fixture.baseUrl,
    CLAUDE_CONFIG_DIR: claudeConfig,
    HOME: root,
    XDG_CONFIG_HOME: xdgConfig,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
    ALL_PROXY: '',
    NO_PROXY: '127.0.0.1,localhost',
  }
  return { fixture, workspace, env }
}

interface RealRuntime {
  readonly ctx: Context
  readonly handles: SubprocessHandle[]
  readonly spawnSpecs: SubprocessSpawnSpec[]
}

async function realRuntime(
  beforeSpawn?: (spec: SubprocessSpawnSpec) => void,
): Promise<RealRuntime> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(LocalSubprocessRuntime)
  const handles: SubprocessHandle[] = []
  const spawnSpecs: SubprocessSpawnSpec[] = []
  const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
  vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => {
    spawnSpecs.push(spec)
    beforeSpawn?.(spec)
    const handle = spawn(spec)
    handles.push(handle)
    return handle
  })
  return { ctx, handles, spawnSpecs }
}

async function realHarness(
  behavior: MessagesBehavior,
  permissionMode?: ClaudeCodePermissionMode,
  nativeAllow: readonly string[] = [],
): Promise<{
  readonly harness: RealHarness
  readonly fixture: MessagesFixture
}> {
  const instance = await realInstanceFixture(behavior, nativeAllow)
  const { ctx, handles, spawnSpecs } = await realRuntime()
  await ctx.plugin(claudeCode, {
    env: instance.env,
    ...permissionMode === undefined ? {} : { permissionMode },
    disposeGraceMs: 3_000,
  })
  const parent = {
    id: 'real-parent',
    session: { header: { cwd: instance.workspace } },
  } as unknown as Agent
  return {
    harness: {
      ctx,
      handles,
      spawnSpecs,
      parent,
      workspace: instance.workspace,
      env: instance.env,
    },
    fixture: instance.fixture,
  }
}

async function expectQuiescent(
  handles: readonly SubprocessHandle[],
): Promise<void> {
  expect(handles.length).toBeGreaterThan(0)
  for (const handle of handles) {
    await expect(handle.waitForExit()).resolves.toBe(true)
    const outcome = await handle.done
    expect(outcome).toHaveProperty('exitCode')
    expect(outcome).toHaveProperty('signal')
  }
}

function expectedFailure(
  stage: 'query-run' | 'process',
  category: 'product-error' | 'process',
  outcome: SubprocessOutcome,
): string {
  const fields = [
    'product: Claude Code',
    `stage: ${stage}`,
    `category: ${category}`,
  ]
  if (outcome.exitCode !== null) fields.push(`exit code: ${outcome.exitCode}`)
  if (outcome.signal !== null) fields.push(`signal: ${outcome.signal}`)
  return `Product subagent failure (${fields.join('; ')})`
}

function expectedObservedFailure(outcome: SubprocessOutcome): string {
  return observedSdkMessages.some(message =>
    message.type === 'result'
    && message.subtype === 'error_during_execution')
    ? expectedFailure('query-run', 'product-error', outcome)
    : expectedFailure('process', 'process', outcome)
}

function startRequest(
  harness: RealHarness,
  prompt: string,
  signal = new AbortController().signal,
) {
  return harness.ctx.subagents.start('claude-code', {
    prompt: [{ type: 'text', text: prompt }],
    parent: harness.parent,
    signal,
  })
}

describe('real Claude Agent SDK 0.3.263 and its distributed Claude Code 2.1.263 fixture', {
  timeout: 60_000,
}, () => {
  it('inherits host settings and sends the exact task and fake key to local Messages', async () => {
    const sentinel = 'REAL_CLAUDE_CODE_SENTINEL_2_1_237'
    const task = 'Return the fixture sentinel exactly.'
    const { harness, fixture } = await realHarness({
      kind: 'complete',
      text: sentinel,
    })
    expect(sdkPackage.version).toBe('0.3.263')
    expect(sdkPackage.claudeCodeVersion).toBe('2.1.263')
    expect(sdkPackage.optionalDependencies[platformPackage]).toBe('0.3.263')
    const version = await execFileAsync(claudeBin, ['--version'], {
      env: { ...process.env, ...harness.env },
    })
    expect(version.stdout.trim()).toBe('2.1.263 (Claude Code)')

    const run = await startRequest(harness, task)
    await expect(run.result).resolves.toEqual({
      output: [{ type: 'text', text: sentinel }],
      stopReason: 'completed',
    })
    await run.dispose()

    const initMessage = observedSdkMessages.find(
      (message): message is SDKSystemMessage =>
        message.type === 'system' && message.subtype === 'init',
    )
    expect(initMessage?.claude_code_version).toBe('2.1.263')
    const spawnedExecutable = harness.spawnSpecs[0]?.argv[0]
    expect(spawnedExecutable).toBeDefined()
    expect(process.platform === 'win32'
      ? realpathSync(spawnedExecutable!).toLowerCase()
      : realpathSync(spawnedExecutable!))
      .toBe(process.platform === 'win32'
        ? realpathSync(claudeBin).toLowerCase()
        : realpathSync(claudeBin))
    expect(fixture.requests).toHaveLength(1)
    const recorded = fixture.requests[0]!
    expect(recorded.method).toBe('POST')
    expect(recorded.path).toMatch(/^\/v1\/messages(?:\?.*)?$/)
    expect(recorded.headers['x-api-key']).toBe(fakeKey)
    expect(recorded.body.model).toBe(settingsModel)
    expect(Array.isArray(recorded.body.messages)).toBe(true)
    const messageTexts = (
      recorded.body.messages as Array<{ content?: unknown }>
    ).flatMap((message): unknown[] =>
      Array.isArray(message.content) ? message.content as unknown[] : [])
      .filter((block): block is { type: string; text: string } =>
        typeof block === 'object'
        && block !== null
        && 'type' in block
        && block.type === 'text'
        && 'text' in block
        && typeof block.text === 'string')
      .map(block => block.text)
    expect(messageTexts.filter(text => text.includes(task))).toEqual([task])
    await expectQuiescent(harness.handles)
  })

  it('maps a real SDK max-turns result to safe query-run facts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-claude-code-max-turns-'))
    roots.push(root)
    const target = join(root, 'max-turns.txt')
    sdkTestOverrides.maxTurns = 1
    const { harness, fixture } = await realHarness({
      kind: 'tool-use',
      toolName: 'Write',
      input: {
        file_path: target,
        content: 'real-sdk-max-turns',
      },
    }, 'bypassPermissions')
    const run = await startRequest(harness, 'Exercise the SDK max-turns result.')
    const result = await run.result
    expect(observedSdkMessages
      .filter(message => message.type === 'result')
      .map(message => message.subtype)).toEqual(['error_max_turns'])
    expect(result).toMatchObject({
      output: [],
      stopReason: 'error',
    })
    expect(result.diagnostic).toContain(
      'product: Claude Code; stage: query-run; category: limit',
    )
    expect(readFileSync(target, 'utf8')).toBe('real-sdk-max-turns')
    expect(result.diagnostic).not.toContain(target)
    expect(result.diagnostic).not.toContain('real-sdk-max-turns')
    await run.dispose()
    expect(fixture.requests).toHaveLength(1)
    await expectQuiescent(harness.handles)
  })

  it('runs two named instances concurrently and unloads one without revoking its run', async () => {
    const safeInstance = await realInstanceFixture({ kind: 'hold' })
    const bypassInstance = await realInstanceFixture({
      kind: 'complete',
      text: 'NAMED_BYPASS_RESULT',
    })
    const { ctx, handles, spawnSpecs } = await realRuntime()
    const safeFiber = await ctx.plugin(claudeCode, {
      providerName: 'claude-safe',
      model: 'claude-safe-model',
      env: safeInstance.env,
      permissionMode: 'dontAsk',
      disposeGraceMs: 3_000,
    })
    const bypassFiber = await ctx.plugin(claudeCode, {
      providerName: 'claude-bypass',
      model: 'claude-bypass-model',
      env: bypassInstance.env,
      permissionMode: 'bypassPermissions',
      disposeGraceMs: 3_000,
    })
    const safeParent = {
      id: 'safe-parent',
      session: { header: { cwd: safeInstance.workspace } },
    } as unknown as Agent
    const bypassParent = {
      id: 'bypass-parent',
      session: { header: { cwd: bypassInstance.workspace } },
    } as unknown as Agent
    const safeController = new AbortController()

    const [safeRun, bypassRun] = await Promise.all([
      ctx.subagents.start('claude-safe', {
        prompt: [{ type: 'text', text: 'Hold the safe instance.' }],
        parent: safeParent,
        signal: safeController.signal,
      }),
      ctx.subagents.start('claude-bypass', {
        prompt: [{ type: 'text', text: 'Complete the bypass instance.' }],
        parent: bypassParent,
        signal: new AbortController().signal,
      }),
    ])
    await safeInstance.fixture.requestStarted
    await safeFiber.dispose()
    expect(ctx.subagents.list()).toEqual(['claude-bypass'])
    await expect(ctx.subagents.start('claude-safe', {
      prompt: [{ type: 'text', text: 'This start must fail.' }],
      parent: safeParent,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'NO_PROVIDER' })

    await expect(bypassRun.result).resolves.toEqual({
      output: [{ type: 'text', text: 'NAMED_BYPASS_RESULT' }],
      stopReason: 'completed',
    })
    safeController.abort(new Error('cancel only the published safe run'))
    await expect(safeRun.result).resolves.toEqual({
      output: [],
      stopReason: 'aborted',
    })
    await Promise.all([safeRun.dispose(), bypassRun.dispose()])
    expect(safeInstance.fixture.requests).toHaveLength(1)
    expect(bypassInstance.fixture.requests).toHaveLength(1)
    expect(safeInstance.fixture.requests[0]?.body.model).toBe('claude-safe-model')
    expect(bypassInstance.fixture.requests[0]?.body.model).toBe('claude-bypass-model')
    expect(safeInstance.fixture.requests[0]?.body.messages)
      .not.toEqual(bypassInstance.fixture.requests[0]?.body.messages)
    expect(spawnSpecs.map(spec => spec.env?.CLAUDE_CONFIG_DIR).sort())
      .toEqual([
        safeInstance.env.CLAUDE_CONFIG_DIR,
        bypassInstance.env.CLAUDE_CONFIG_DIR,
      ].sort())
    await expectQuiescent(handles)
    await bypassFiber.dispose()
    expect(ctx.subagents.list()).toEqual([])
  })

  it('maps a real CLI process failure to its exit outcome', async () => {
    const { harness, fixture } = await realHarness({ kind: 'hold' })
    const run = await startRequest(harness, 'Exercise the failure path.')
    await fixture.requestStarted
    expect(harness.handles).toHaveLength(1)
    harness.handles[0]!.terminate()
    const outcome = await harness.handles[0]!.done
    const result = await run.result
    expect(result.output).toEqual([])
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toBe(expectedObservedFailure(outcome))
    await run.dispose()
    expect(fixture.requests).toHaveLength(1)
    expect(fixture.requests[0]!.headers['x-api-key']).toBe(fakeKey)
    await expectQuiescent(harness.handles)
  })

  it('bounds Native Read when SDK settings allow the parent directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-claude-code-native-read-scope-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    mkdirSync(workspace)
    const outsidePath = join(root, 'outside-secret.txt')
    const outsideSecret = 'NATIVE_READ_OUTSIDE_WORKSPACE_SECRET'
    writeFileSync(outsidePath, outsideSecret)
    const fixture = await startMessagesFixture({
      kind: 'tool-use',
      toolName: 'Read',
      input: { file_path: outsidePath },
      finalText: 'The outside read was denied.',
    })
    fixtures.push(fixture)
    const runtime = await realRuntime((spec) => {
      const configDir = spec.env?.['CLAUDE_CONFIG_DIR']
      expect(configDir).toBeDefined()
      const settingsPath = join(configDir!, 'settings.json')
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
        permissions: {
          additionalDirectories: string[]
          blockReadsOutsideWorkingDirectories: boolean
        }
      }
      settings.permissions.additionalDirectories = [root]
      writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
    })
    const controller = new AbortController()
    const owned: Array<() => void | Promise<void>> = []
    let driver: NativeExternalSubagentDriver | undefined
    const nativeContext = {
      signal: controller.signal,
      require: (name: string) => {
        if (name === 'credentials') {
          return { resolve: async () => ({ value: fakeKey }) }
        }
        if (name === 'sandbox') {
          return { confineChildProcess: () => { throw new Error('unexpected sandbox call') } }
        }
        if (name === 'subprocess') return runtime.ctx.subprocess
        throw new Error(`unexpected Native service ${name}`)
      },
      provide: (name: string, service: unknown) => {
        if (name !== 'externalSubagentDriver') throw new Error(`unexpected Native service ${name}`)
        driver = service as NativeExternalSubagentDriver
      },
      own: (dispose: () => void | Promise<void>) => {
        owned.push(dispose)
        return async () => { await dispose() }
      },
    } as unknown as NativeContext
    await nativeClaudeCode.resolve({
      name: 'claude-native-fixture',
      model: 'claude-native-fixture-model',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      baseUrl: fixture.baseUrl,
      disposeGraceMs: 3_000,
    })(nativeContext)
    expect(driver).toBeDefined()
    const request = {
      id: 'native-outside-read' as NativeExternalSubagentRequest['id'],
      parentSessionId: 'native-parent' as SessionId,
      rootSessionId: 'native-parent' as SessionId,
      parentEpoch: 'parent-epoch',
      rootEpoch: 'parent-epoch',
      parentDepth: 0,
      maxDepth: 1,
      limits: { maxSteps: 2 },
      authority: {
        toolNames: ['read_file'],
        builtinToolNames: ['read_file'],
        sandboxPolicy: {
          mode: 'danger-full-access' as const,
          workspaceRoot: workspace,
          sessionId: 'native-parent' as SessionId,
        },
        approvalRequired: false,
      },
      label: 'Read only the selected workspace',
      cwd: workspace,
      prompt: [{ type: 'text' as const, text: `Read ${outsidePath}.` }],
      route: {
        provider: 'claude-native-fixture',
        model: 'engine-route-model-must-not-win',
        overrides: {},
      },
    } satisfies NativeExternalSubagentRequest
    await expect(driver!.start({ ...request, cwd: root }, controller.signal))
      .rejects.toThrow('child workspace must remain inside the parent workspace root')
    expect(runtime.spawnSpecs).toHaveLength(0)
    const run = await driver!.start(request, controller.signal)
    let configDir: string | undefined
    try {
      await fixture.requestStarted
      await expect(run.result).resolves.toEqual({
        output: [{ type: 'text', text: 'The outside read was denied.' }],
        stopReason: 'completed',
      })
      await vi.waitFor(() => expect(fixture.requests).toHaveLength(2))
      expect(fixture.requests[0]?.body.model).toBe('claude-native-fixture-model')
      const secondMessages = fixture.requests[1]?.body.messages
      expect(Array.isArray(secondMessages)).toBe(true)
      const toolResults = (secondMessages as Array<{ content?: unknown }>).flatMap(message =>
        Array.isArray(message.content) ? message.content : [])
        .filter((block): block is { type: string; tool_use_id: string; content: string } =>
          typeof block === 'object'
          && block !== null
          && 'type' in block
          && block.type === 'tool_result'
          && 'tool_use_id' in block
          && block.tool_use_id === 'toolu_dsh_fixture'
          && 'content' in block
          && typeof block.content === 'string')
      expect(toolResults).toHaveLength(1)
      expect(toolResults[0]?.content).toContain('outside the parent workspace')
      expect(JSON.stringify(fixture.requests)).not.toContain(outsideSecret)
      expect(runtime.spawnSpecs).toHaveLength(1)
      expect(runtime.spawnSpecs[0]?.env?.ANTHROPIC_BASE_URL).toBe(fixture.baseUrl)
      configDir = runtime.spawnSpecs[0]?.env?.CLAUDE_CONFIG_DIR
      expect(configDir).toContain('dsh-claude-code-native-')
      expect(JSON.parse(readFileSync(join(configDir!, 'settings.json'), 'utf8'))).toEqual({
        permissions: {
          additionalDirectories: [root],
          blockReadsOutsideWorkingDirectories: true,
        },
      })
    } finally {
      controller.abort(new Error('finish Native read-scope fixture'))
      await run.dispose()
      await Promise.all(owned.map(dispose => dispose()))
    }
    expect(configDir).toBeDefined()
    expect(existsSync(configDir!)).toBe(false)
    await expectQuiescent(runtime.handles)
  })

  it('classifies direct Native disposal as cancellation and settles the SDK child', async () => {
    const { fixture, workspace } = await realInstanceFixture({ kind: 'hold' })
    const runtime = await realRuntime()
    const providerLifetime = new AbortController()
    const caller = new AbortController()
    const owned: Array<() => void | Promise<void>> = []
    let driver: NativeExternalSubagentDriver | undefined
    const nativeContext = {
      signal: providerLifetime.signal,
      require: (name: string) => {
        if (name === 'credentials') return { resolve: async () => ({ value: fakeKey }) }
        if (name === 'sandbox') return { confineChildProcess: () => { throw new Error('unexpected sandbox call') } }
        if (name === 'subprocess') return runtime.ctx.subprocess
        throw new Error(`unexpected Native service ${name}`)
      },
      provide: (name: string, service: unknown) => {
        if (name !== 'externalSubagentDriver') throw new Error(`unexpected Native service ${name}`)
        driver = service as NativeExternalSubagentDriver
      },
      own: (dispose: () => void | Promise<void>) => {
        owned.push(dispose)
        return async () => { await dispose() }
      },
    } as unknown as NativeContext
    await nativeClaudeCode.resolve({
      name: 'claude-native-dispose-fixture',
      model: 'claude-native-fixture-model',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      baseUrl: fixture.baseUrl,
      disposeGraceMs: 3_000,
    })(nativeContext)
    const request = {
      id: 'native-dispose' as NativeExternalSubagentRequest['id'],
      parentSessionId: 'native-parent' as SessionId,
      rootSessionId: 'native-parent' as SessionId,
      parentEpoch: 'parent-epoch',
      rootEpoch: 'parent-epoch',
      parentDepth: 0,
      maxDepth: 1,
      limits: { maxSteps: 2 },
      authority: {
        toolNames: [],
        builtinToolNames: [],
        sandboxPolicy: {
          mode: 'danger-full-access' as const,
          workspaceRoot: workspace,
          sessionId: 'native-parent' as SessionId,
        },
        approvalRequired: false,
      },
      label: 'Cancel the active Native Claude child',
      cwd: workspace,
      prompt: [{ type: 'text' as const, text: 'Wait for cancellation.' }],
      route: {
        provider: 'claude-native-dispose-fixture',
        model: 'engine-route-model-must-not-win',
        overrides: {},
      },
    } satisfies NativeExternalSubagentRequest
    const run = await driver!.start(request, caller.signal)
    await fixture.requestStarted
    const disposal = run.dispose()
    expect(run.dispose()).toBe(disposal)
    await expect(run.result).resolves.toEqual({ output: [], stopReason: 'aborted' })
    expect(caller.signal.aborted).toBe(false)
    await disposal
    await Promise.all(owned.map(dispose => dispose()))
    await expectQuiescent(runtime.handles)
    const privateHome = runtime.spawnSpecs[0]?.env?.HOME
    expect(privateHome).toBeDefined()
    expect(existsSync(privateHome!)).toBe(false)
  })

  it('overrides interactive settings, denies a write, and returns a safe diagnostic', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-claude-code-denied-target-'))
    roots.push(root)
    const target = join(root, 'denied.txt')
    const { harness } = await realHarness({
      kind: 'tool-use',
      toolName: 'Write',
      input: {
        file_path: target,
        content: 'SECRET_TOKEN must not reach the diagnostic',
      },
    })
    const run = await startRequest(harness, 'Write the requested fixture file.')
    await vi.waitFor(() => {
      expect(observedSdkMessages.some(message =>
        message.type === 'system'
        && message.subtype === 'permission_denied')).toBe(true)
    }, { timeout: 30_000 })
    expect(existsSync(target)).toBe(false)
    harness.handles[0]!.terminate()
    const outcome = await harness.handles[0]!.done
    const result = await run.result
    expect(result.output).toEqual([])
    expect(result.stopReason).toBe('error')
    const diagnosticLines = result.diagnostic?.split('\n') ?? []
    expect(diagnosticLines[0]).toBe(expectedObservedFailure(outcome))
    expect(diagnosticLines[1]).toBe(
      'Claude Code unattended decision (mode: dontAsk; request: tool permission; decision: denied): Claude Code denied the request before an interactive prompt',
    )
    expect(result.diagnostic).not.toContain(target)
    expect(result.diagnostic).not.toContain('SECRET_TOKEN')
    await run.dispose()
    await expectQuiescent(harness.handles)
  })

  it('runs an explicitly selected bypass write in the isolated workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-claude-code-bypass-target-'))
    roots.push(root)
    const target = join(root, 'bypass.txt')
    const { harness } = await realHarness({
      kind: 'tool-use',
      toolName: 'Write',
      input: {
        file_path: target,
        content: 'bypass write completed',
      },
      finalText: 'write complete',
    }, 'bypassPermissions')
    const run = await startRequest(harness, 'Write the requested fixture file.')
    await expect(run.result).resolves.toEqual({
      output: [{ type: 'text', text: 'write complete' }],
      stopReason: 'completed',
    })
    expect(readFileSync(target, 'utf8')).toBe('bypass write completed')
    await run.dispose()
    await expectQuiescent(harness.handles)
  })

  it('returns the completed plan without approving execution', async () => {
    const { harness, fixture } = await realHarness({
      kind: 'tool-use',
      toolName: 'ExitPlanMode',
      input: {},
      finalText: 'PLAN_ONLY_RESULT',
    }, 'plan', ['ExitPlanMode'])
    const run = await startRequest(harness, 'Design the fixture change without implementing it.')
    await expect(run.result).resolves.toEqual({
      output: [{ type: 'text', text: 'PLAN_ONLY_RESULT' }],
      stopReason: 'completed',
    })
    expect(fixture.requests).toHaveLength(2)
    expect(JSON.stringify(fixture.requests[1]?.body.messages))
      .toContain('ExitPlanMode is disabled for this session')
    await run.dispose()
    await expectQuiescent(harness.handles)
  })

  it('settles cancellation and leaves the real SDK-spawned CLI tree quiescent', async () => {
    const { harness, fixture } = await realHarness({ kind: 'hold' })
    const controller = new AbortController()
    const run = await startRequest(
      harness,
      'Wait for cancellation.',
      controller.signal,
    )
    await fixture.requestStarted
    controller.abort(new Error('real product cancellation'))
    await expect(run.result).resolves.toEqual({
      output: [],
      stopReason: 'aborted',
    })
    await run.dispose()
    await expectQuiescent(harness.handles)
  })
})

/** Bounded Native compatibility adapter for Claude Code's own model and tools. */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { credentialRef } from '@deepseek-ai/dsh-credentials/native'
import type { NativeContext, NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {
  NativeExternalSubagentDriver,
  NativeExternalSubagentOutcome,
  NativeExternalSubagentRequest,
  NativeExternalSubagentRun,
} from '@deepseek-ai/dsh-native-subagent/native'
import type { ConfinedArgv, ProcessSandbox, SandboxPolicy } from '@deepseek-ai/dsh-sandbox/native'
import type { SubprocessOperations, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess/native'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { startClaudeCodeProductRun, textTask } from './controller.ts'
import type { ClaudeCodeProductRun, ClaudeCodeRunSpec } from './controller.ts'

interface Config {
  readonly name: string
  readonly model: string
  readonly apiKeyEnv: string
  readonly baseUrl?: string
  readonly disposeGraceMs: number
}

interface StartOwner {
  readonly settled: Promise<void>
  readonly finish: () => void
  close?: () => Promise<void>
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('subagent-claude-code: Native configuration must be an object')
  }
  return value as Record<string, unknown>
}

function resolveConfig(input: unknown): Config {
  const fields = object(input)
  const allowed = new Set(['name', 'model', 'apiKeyEnv', 'baseUrl', 'disposeGraceMs'])
  const unsupported = Object.keys(fields).find(key => !allowed.has(key))
  if (unsupported !== undefined) {
    throw new TypeError(`subagent-claude-code: unsupported Native configuration field ${JSON.stringify(unsupported)}`)
  }
  const name = fields['name'] ?? 'claude-code'
  const model = fields['model']
  const apiKeyEnv = fields['apiKeyEnv'] ?? 'ANTHROPIC_API_KEY'
  const baseUrl = fields['baseUrl']
  const disposeGraceMs = fields['disposeGraceMs'] ?? 3_000
  if (typeof name !== 'string' || name.trim() !== name || name.length === 0) {
    throw new TypeError('subagent-claude-code: Native name must be a nonempty trimmed string')
  }
  if (typeof model !== 'string' || model.trim() !== model || model.length === 0) {
    throw new TypeError('subagent-claude-code: Native model must be an explicit nonempty string')
  }
  if (typeof apiKeyEnv !== 'string' || !['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'].includes(apiKeyEnv)) {
    throw new TypeError('subagent-claude-code: apiKeyEnv must be ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN')
  }
  if (baseUrl !== undefined) {
    if (typeof baseUrl !== 'string' || baseUrl.trim() !== baseUrl) {
      throw new TypeError('subagent-claude-code: baseUrl must be an absolute HTTP(S) URL')
    }
    let parsed: URL
    try {
      parsed = new URL(baseUrl)
    } catch {
      throw new TypeError('subagent-claude-code: baseUrl must be an absolute HTTP(S) URL')
    }
    if (!['http:', 'https:'].includes(parsed.protocol)
      || parsed.username.length > 0 || parsed.password.length > 0 || parsed.hash.length > 0) {
      throw new TypeError('subagent-claude-code: baseUrl must be an absolute HTTP(S) URL without credentials or a fragment')
    }
  }
  if (typeof disposeGraceMs !== 'number' || !Number.isFinite(disposeGraceMs)
    || disposeGraceMs <= 0 || disposeGraceMs > MAX_TIMER_DELAY_MS) {
    throw new TypeError(`subagent-claude-code: disposeGraceMs must be positive, finite, and no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  return Object.freeze({
    name,
    model,
    apiKeyEnv,
    ...baseUrl === undefined ? {} : { baseUrl },
    disposeGraceMs,
  })
}

function validateRequest(request: NativeExternalSubagentRequest): string {
  if (request.route.overrides.provider !== undefined
    || request.route.overrides.model !== undefined
    || request.route.overrides.reasoningEffort !== undefined) {
    throw new Error('subagent-claude-code: Native route overrides are not supported; configure the Claude model on the selected Provider')
  }
  if (request.persona !== undefined) throw new Error('subagent-claude-code: persona is not supported by the Native compatibility route')
  if (request.toolFilter !== undefined) throw new Error('subagent-claude-code: toolFilter is not supported by the Native compatibility route')
  if (request.outputSchema !== undefined) throw new Error('subagent-claude-code: outputSchema is not supported by the Native compatibility route')
  if (request.approval !== undefined) throw new Error('subagent-claude-code: parent approval relay is not supported by the Native compatibility route')
  if (request.limits.maxTokens !== undefined) {
    throw new Error('subagent-claude-code: Native maxTokens cannot be enforced by the Claude Agent SDK; refusing startup')
  }
  return textTask(request.prompt)
}

function canonicalDirectory(path: string, label: string): string {
  try {
    const canonical = realpathSync.native(path)
    if (!statSync(canonical).isDirectory()) throw new Error('not a directory')
    return canonical
  } catch {
    throw new Error(`subagent-claude-code: ${label} must be an existing directory`)
  }
}

function privateHome(
  workspaceRoot: string,
  writableTempRoot?: string,
): { readonly root: string; readonly config: string; readonly xdg: string } {
  const parent = realpathSync.native(writableTempRoot ?? tmpdir())
  const created = mkdtempSync(join(parent, 'dsh-claude-code-native-'))
  let root: string
  try {
    root = realpathSync.native(created)
    if (dirname(root) !== parent) throw new Error('temporary home escaped its owning temp root')
    const config = join(root, '.claude')
    const xdg = join(root, '.config')
    mkdirSync(config)
    mkdirSync(xdg)
    writeFileSync(join(config, 'settings.json'), `${JSON.stringify({
      permissions: {
        additionalDirectories: [workspaceRoot],
        blockReadsOutsideWorkingDirectories: true,
      },
    })}\n`)
    return { root, config, xdg }
  } catch {
    rmSync(created, { recursive: true, force: true })
    throw new Error('subagent-claude-code: could not create an isolated Claude home')
  }
}

async function waitUntilReady(ready: Promise<string>, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Preserve the exact AbortSignal reason.
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([ready, aborted])
  } finally {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
  }
}

function nativeOutcome(text: string): NativeExternalSubagentOutcome {
  return { output: [{ type: 'text', text }], stopReason: 'completed' }
}

function createDriver(context: NativeContext, config: Config): NativeExternalSubagentDriver & { dispose(): Promise<void> } {
  const active = new Set<() => Promise<void>>()
  const starting = new Set<StartOwner>()
  const lifetime = new AbortController()
  let closed = false
  let closing: Promise<void> | undefined

  async function dispose(): Promise<void> {
    if (closing !== undefined) return closing
    closed = true
    lifetime.abort(new Error('subagent-claude-code Native Provider is closing'))
    const starts = [...starting]
    closing = (async () => {
      const early = await Promise.allSettled(starts.map(start => start.close?.() ?? Promise.resolve()))
      await Promise.all(starts.map(start => start.settled))
      const runs = await Promise.allSettled([...active].map(disposeRun => disposeRun()))
      const errors = [...early, ...runs].flatMap(result =>
        result.status === 'rejected' ? [result.reason as unknown] : [])
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new AggregateError(errors, 'subagent-claude-code Native child cleanup failed')
    })()
    return closing
  }

  const driver: NativeExternalSubagentDriver & { dispose(): Promise<void> } = {
    name: config.name,
    routeFields: [],
    capabilities: { persona: false, toolFilter: false, outputSchema: false, approvalRelay: false },
    dispose,
    async start(request, signal): Promise<NativeExternalSubagentRun> {
      if (closed) throw new Error('subagent-claude-code Native Provider is closing')
      const completion = Promise.withResolvers<void>()
      const owner: StartOwner = { settled: completion.promise, finish: () => { completion.resolve() } }
      starting.add(owner)
      const childSignal = AbortSignal.any([signal, context.signal, lifetime.signal])
      let home: ReturnType<typeof privateHome> | undefined
      let product: ClaudeCodeProductRun | undefined
      try {
        childSignal.throwIfAborted()
        const prompt = validateRequest(request)
        const policy = request.authority.sandboxPolicy
        if (policy === undefined) throw new Error('subagent-claude-code requires the exact parent Session sandbox policy')
        if (policy.sessionId !== undefined && policy.sessionId !== request.parentSessionId) {
          throw new Error('subagent-claude-code received a sandbox policy for another parent Session')
        }
        const workspaceRoot = canonicalDirectory(policy.workspaceRoot, 'parent workspace root')
        const cwd = canonicalDirectory(request.cwd, 'parent workspace')
        const cwdFromRoot = relative(workspaceRoot, cwd)
        if (cwdFromRoot === '..' || cwdFromRoot.startsWith(`..${sep}`) || isAbsolute(cwdFromRoot)) {
          throw new Error('subagent-claude-code child workspace must remain inside the parent workspace root')
        }
        const credential = await context.require('credentials').resolve(credentialRef(config.apiKeyEnv))
        childSignal.throwIfAborted()
        if (credential === undefined || credential.value.length === 0) {
          throw new Error(`subagent-claude-code has no configured credential for ${config.apiKeyEnv}`)
        }
        const subprocess: SubprocessOperations = context.require('subprocess')
        const sandbox: ProcessSandbox = context.require('sandbox')
        const writableTempRoot = policy.mode === 'workspace-write'
          ? sandbox.prepareWritableTempRoot?.({ ...policy, mode: 'workspace-write' } satisfies SandboxPolicy)
          : undefined
        const nativeHome = privateHome(workspaceRoot, writableTempRoot)
        home = nativeHome
        const allowRead = request.authority.builtinToolNames.includes('read_file')
        const spec: ClaudeCodeRunSpec = {
          cwd,
          model: config.model,
          permissionMode: 'dontAsk',
          env: {
            [config.apiKeyEnv]: credential.value,
            HOME: nativeHome.root,
            USERPROFILE: nativeHome.root,
            CLAUDE_CONFIG_DIR: nativeHome.config,
            XDG_CONFIG_HOME: nativeHome.xdg,
            ...(config.baseUrl === undefined ? {} : { ANTHROPIC_BASE_URL: config.baseUrl }),
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
            CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
            DISABLE_TELEMETRY: '1',
            DISABLE_ERROR_REPORTING: '1',
          },
          removeAmbientEnv: ['ANTHROPIC_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL', 'ANTHROPIC_BASE_URL'],
          nativeExecution: { maxTurns: request.limits.maxSteps, allowRead, workspaceRoot },
          disposeGraceMs: config.disposeGraceMs,
          spawn: (spawn: SubprocessSpawnSpec) => {
            const spawnCwd = spawn.cwd
            if (spawnCwd !== cwd) {
              throw new Error('subagent-claude-code SDK changed the selected workspace')
            }
            let confined: ConfinedArgv | undefined
            switch (policy.mode) {
              case 'danger-full-access':
                break
              case 'read-only':
                confined = sandbox.confineChildProcess(spawn.argv, {
                  ...policy,
                  mode: 'read-only',
                } satisfies SandboxPolicy, { cwd, privateHome: nativeHome.root })
                break
              case 'workspace-write':
                confined = sandbox.confineChildProcess(spawn.argv, {
                  ...policy,
                  mode: 'workspace-write',
                } satisfies SandboxPolicy, { cwd, privateHome: nativeHome.root })
                break
            }
            const handle = subprocess.spawn(confined === undefined ? spawn : { ...spawn, argv: confined.argv })
            return handle
          },
        }
        const startedProduct = await startClaudeCodeProductRun(prompt, spec, childSignal)
        product = startedProduct
        owner.close = () => startedProduct.dispose()
        const remoteId = await waitUntilReady(startedProduct.ready, childSignal)
        childSignal.throwIfAborted()
        let disposal: Promise<void> | undefined
        let locallyCancelled = false
        let resultSettled = false
        const disposeRun = (): Promise<void> => disposal ??= (async () => {
          if (!resultSettled) locallyCancelled = true
          try {
            await startedProduct.dispose()
            rmSync(nativeHome.root, { recursive: true, force: true })
          } finally {
            active.delete(disposeRun)
          }
        })()
        active.add(disposeRun)
        const result: Promise<NativeExternalSubagentOutcome> = startedProduct.result.then(
          (output) => {
            resultSettled = true
            return locallyCancelled || childSignal.aborted
              ? { output: [], stopReason: 'aborted' }
              : nativeOutcome(output)
          },
          () => {
            resultSettled = true
            return {
              output: [],
              stopReason: locallyCancelled || childSignal.aborted ? 'aborted' : 'error',
            }
          },
        )
        return { remoteId, result, dispose: disposeRun }
      } catch (error: unknown) {
        if (product !== undefined) {
          try {
            await product.dispose()
            if (home !== undefined) rmSync(home.root, { recursive: true, force: true })
          } catch (cleanupError: unknown) {
            throw new AggregateError([error, cleanupError], 'subagent-claude-code startup and cleanup failed')
          }
        } else if (home !== undefined) {
          rmSync(home.root, { recursive: true, force: true })
        }
        throw error
      } finally {
        starting.delete(owner)
        owner.finish()
      }
    },
  }
  return driver
}

/** Install the bounded Native Claude adapter over the one shared product controller. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-subagent-claude-code',
  targets: ['host'],
  requires: ['credentials', 'sandbox', 'subprocess'],
  provides: ['externalSubagentDriver'],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      const driver = createDriver(context, config)
      context.own(() => driver.dispose())
      context.provide('externalSubagentDriver', driver)
    }
  },
}

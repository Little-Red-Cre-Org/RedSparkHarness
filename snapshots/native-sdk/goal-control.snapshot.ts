/** Goal-owned native SDK interruption, retained inbox, cold restore, and human rearm. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { execa } from 'execa'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { DeepSeekHarness, type HarnessNotification, type RunResult } from '@deepseek-ai/dsh-sdk-client'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { deadline } from '@deepseek-ai/dsh-timeout'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'
import {
  formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizedSystemPrompts, normalizedToolSchemas,
  normalizeSessionSnapshot, redactSessionSnapshotIds,
} from '@deepseek-ai/dsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scenario = join(root, 'snapshots/native-sdk/goal-control')
const fixture = join(scenario, 'session.v3.jsonl')
const sessionId = 'sdk-goal-control'
const objective = 'Complete the controlled Goal lifecycle.'
const bootstrapText = 'Start the controlled native SDK session.'
const humanText = 'Keep this ordinary human input through the Goal pause.'
const wakeText = 'Wake the parked SDK owner after the Goal pause settles.'
const coldText = 'Check the restored Goal before rearming it.'
const resumeText = 'Explicitly resume the Goal after cold restore.'

interface ModelRequest extends Record<string, unknown> {
  readonly messages: Array<{ readonly role: string; readonly content: unknown }>
}

interface ModelEvidence {
  readonly input: string
  readonly round: number | undefined
  readonly outcome: 'completed' | 'interrupted'
  readonly retainedInputs: string[]
}

interface GoalControlState {
  readonly ownerToken: string
  readonly agentToken: string
  readonly sessionId: string
  readonly goal: Record<string, unknown>
}

function textBlock(event: SessionEvent): string | undefined {
  if (event.type !== 'user/message') return undefined
  return event.data.content.find(block => block.type === 'text')?.text
}

function sourceGoal(event: SessionEvent): { goalId: string; revision: number; round: number } | undefined {
  if (event.type !== 'user/message' || event.data.source.kind !== 'goal') return undefined
  return event.data.source
}

function turnForEvent(events: readonly SessionEvent[], selected: SessionEvent): number | undefined {
  const index = events.indexOf(selected)
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const event = events[cursor]
    if (event?.type === 'turn/start') return event.data.turn
  }
  return undefined
}

function reportFailure(response: ServerResponse, failure: unknown): void {
  response.writeHead(500, { 'content-type': 'text/plain' })
  response.end(failure instanceof Error ? failure.message : String(failure))
}

function errorDetails(failure: unknown): unknown {
  if (failure instanceof AggregateError) return { name: failure.name, message: failure.message, stack: failure.stack,
    errors: [...failure.errors].map(errorDetails) }
  if (failure instanceof Error) return { name: failure.name, message: failure.message, stack: failure.stack,
    ...(failure.cause === undefined ? {} : { cause: errorDetails(failure.cause) }),
    ...('stderr' in failure && typeof failure.stderr === 'string' ? { stderr: failure.stderr } : {}),
    ...('stdout' in failure && typeof failure.stdout === 'string' ? { stdout: failure.stdout } : {}),
    ...('shortMessage' in failure && typeof failure.shortMessage === 'string'
      ? { shortMessage: failure.shortMessage } : {}) }
  return failure
}

async function waitForEvidence<T>(stage: string, operation: Promise<T>, report: () => unknown): Promise<T> {
  const timeout = deadline(undefined, 15_000, 'NATIVE_SDK_GOAL_SNAPSHOT')
  const timedOut = new Promise<never>((_resolve, reject) => {
    const abort = (): void => reject(new Error(`native SDK Goal snapshot: ${stage} deadline; ${JSON.stringify(report())}`,
      { cause: timeout.signal.reason }))
    if (timeout.signal.aborted) abort()
    else timeout.signal.addEventListener('abort', abort, { once: true })
  })
  try {
    return await Promise.race([operation, timedOut])
  } finally {
    timeout[Symbol.dispose]()
  }
}

function userTexts(request: ModelRequest): string[] {
  return request.messages.filter(message => message.role === 'user').flatMap(message => {
    if (typeof message.content === 'string') return [message.content]
    if (!Array.isArray(message.content)) return []
    return message.content.flatMap((item: unknown) => item !== null && typeof item === 'object' && 'type' in item
      && item.type === 'text' && 'text' in item && typeof item.text === 'string' ? [item.text] : [])
  })
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}

function sse(text: string): string {
  return [
    { choices: [{ delta: { role: 'assistant', content: text } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
}

function lastUserText(request: ModelRequest): string {
  const latest = [...request.messages].reverse().find(message => message.role === 'user')
  if (typeof latest?.content === 'string') return latest.content
  if (Array.isArray(latest?.content)) {
    const block = latest.content.find((item): item is { type: 'text'; text: string } =>
      item !== null && typeof item === 'object' && 'type' in item && item.type === 'text'
        && 'text' in item && typeof item.text === 'string')
    return block?.text ?? ''
  }
  return ''
}

it('projects Goal interruption and cold rearm through both native SDKs', async () => {
  const recorded = existsSync(fixture) ? parseSessionLog(readFileSync(fixture, 'utf8')) : undefined
  const recordedInput = recorded?.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const task = recordedInput === undefined ? bootstrapText : textBlock(recordedInput) ?? bootstrapText
  const releasePause = Promise.withResolvers<void>()
  const goalRequestStarted = Promise.withResolvers<void>()
  const pauseSettledSignal = Promise.withResolvers<Record<string, unknown>>()
  const requests: ModelRequest[] = []
  const admissions: ModelEvidence[] = []
  const attached: GoalControlState[] = []
  const goalChanges: Record<string, unknown>[] = []
  const humanConsumed: Record<string, unknown>[] = []
  const pauseSettled: Record<string, unknown>[] = []
  const pauseStages: Record<string, unknown>[] = []
  const humanRearmed: Record<string, unknown>[] = []
  const sdkNotifications: HarnessNotification[] = []
  const serverFailures: unknown[] = []
  let resultSummaries: Record<string, string | undefined> = {}
  let goalRequestAborted = false
  let pauseClaimed = false
  let stage = 'build native SDK Goal fixture'
  let primaryFailure: unknown
  const observed = () => ({ stage, providerRequests: requests.length, admissions, attached,
    goalChanges: goalChanges.map(value => (value.event as { data?: { operation?: string } }).data?.operation),
    sdkEvents: sdkNotifications.filter(notification => notification.method === 'session.event')
      .map(notification => (notification.params.event as { type?: string }).type).slice(-20),
    humanConsumed, pauseSettled, pauseStages, humanRearmed, goalRequestAborted, pauseClaimed })
  const updateStage = (value: string): void => {
    stage = value
    process.stderr.write(`native SDK Goal snapshot stage: ${stage}\n`)
  }
  const server = createServer((request, response) => {
    const handle = async (): Promise<void> => {
      if (request.url === '/release-goal-pause') {
        releasePause.resolve()
        pauseStages.push({ stage: 'server released pause claim gate' })
        response.end('released')
        return
      }
      if (request.url === '/await-goal-round-one') {
        const abandoned = new Promise<void>(resolve => response.once('close', resolve))
        await Promise.race([goalRequestStarted.promise, abandoned])
        if (!response.writableEnded) response.end('started')
        return
      }
      if (request.url === '/await-goal-pause-settled') {
        const abandoned = new Promise<void>(resolve => response.once('close', resolve))
        await Promise.race([pauseSettledSignal.promise.then(() => undefined), abandoned])
        if (!response.writableEnded) response.end('settled')
        return
      }
      if (request.url === '/goal-diagnostics') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(observed()))
        return
      }
      if (request.url === '/goal-pause-claim') {
        if (pauseClaimed) throw new Error('native SDK Goal snapshot: duplicate round pause claim')
        pauseClaimed = true
        await releasePause.promise
        response.end('pause')
        return
      }
      if (request.url?.startsWith('/goal-') === true) {
        const value = JSON.parse(await readBody(request)) as Record<string, unknown>
        if (request.url === '/goal-owner-attached') attached.push(value as unknown as GoalControlState)
        else if (request.url === '/goal-change') goalChanges.push(value)
        else if (request.url === '/goal-human-consumed') humanConsumed.push(value)
        else if (request.url === '/goal-pause-stage') pauseStages.push(value)
        else if (request.url === '/goal-failure') serverFailures.push(value)
        else if (request.url === '/goal-pause-settled') {
          pauseSettled.push(value)
          pauseSettledSignal.resolve(value)
        }
        else if (request.url === '/goal-human-rearmed') humanRearmed.push(value)
        else throw new Error(`native SDK Goal snapshot: unexpected control route ${request.url}`)
        response.end('ok')
        return
      }

      const modelRequest = JSON.parse(await readBody(request)) as ModelRequest
      requests.push(modelRequest)
      const input = lastUserText(modelRequest)
      const submittedUserTexts = userTexts(modelRequest)
      const retainedInputs = submittedUserTexts.filter(text => text === humanText || text === wakeText)
      const round = input.match(/<goal_round>[\s\S]*?Round: (\d+)\//)?.[1]
      if (round === '1') {
        goalRequestStarted.resolve()
        admissions.push({ input, round: 1, outcome: 'interrupted', retainedInputs })
        response.on('close', () => { if (!response.writableEnded) goalRequestAborted = true })
        return
      }
      const reply = input.includes('<goal_round>') ? 'Goal rearmed and continued.'
        : input === task ? 'Native SDK session started.'
          : input === wakeText && submittedUserTexts.includes(humanText)
            ? 'The retained input and explicit wake input were consumed.'
            : input === coldText ? 'Cold restore admitted the human input.'
              : input === resumeText ? 'The human explicitly rearmed the Goal.'
                : 'Goal lifecycle complete.'
      admissions.push({ input, round: round === undefined ? undefined : Number(round), outcome: 'completed', retainedInputs })
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(sse(reply))
    }
    void handle().catch(failure => { serverFailures.push(failure); reportFailure(response, failure) })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('native SDK Goal snapshot: missing test endpoint')
  const controlUrl = `http://127.0.0.1:${address.port}`
  const home = mkdtempSync(join(tmpdir(), 'dsh-native-sdk-goal-snapshot-'))
  const workspace = join(home, 'workspace')
  const sessions = join(home, 'sessions')
  const patch = join(home, 'model.patch.json')
  mkdirSync(workspace)
  const profile = join(home, 'profiles', 'native-sdk')
  const fixturePackage = join(profile, 'node_modules', 'fixture-sdk-goal-control')
  mkdirSync(fixturePackage, { recursive: true })
  const fixtureUrl = pathToFileURL(join(root, 'snapshots/native-sdk/text-turn/goal-control.mjs')).href
  const { plugin } = await import(fixtureUrl) as { plugin: {
    apiVersion: number; targets: string[]; requires: string[]; optional: string[]; provides: string[]
  } }
  writeFileSync(join(fixturePackage, 'native.mjs'), `export { plugin } from ${JSON.stringify(fixtureUrl)}\n`)
  writeFileSync(join(fixturePackage, 'package.json'), JSON.stringify({ name: 'fixture-sdk-goal-control', type: 'module',
    exports: { './package.json': './package.json', './native': './native.mjs' },
    dsh: { native: { apiVersion: plugin.apiVersion, entry: './native', targets: plugin.targets,
      requires: plugin.requires, optional: plugin.optional ?? [], provides: plugin.provides } } }))
  const composition = shippedNativeProfileComposition(home, 'native-sdk')
  const shippedGoal = shippedNativeProfileComposition(home, 'native-headless').installations
    .filter(row => ['goal', 'goal-round-driver', 'tool-goal'].includes(row.id))
  expect(shippedGoal.map(row => row.plugin)).toEqual([
    '@deepseek-ai/dsh-goal', '@deepseek-ai/dsh-goal-round-driver', '@deepseek-ai/dsh-tool-goal',
  ])
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'native-sdk-goal-fixture', private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } }))
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ ...composition, installations: [
    ...composition.installations,
    ...shippedGoal,
    { id: 'fixture-sdk-goal-control', plugin: 'fixture-sdk-goal-control', scope: 'root', config: {
      controlUrl, sessionId, objective, humanText, wakeText, resumeText,
    } },
  ] }))
  writeFileSync(patch, JSON.stringify({ formatVersion: 1, installations: [
    { id: 'app', config: { systemPrompt: 'Follow the Goal lifecycle and report each result.', maxSteps: 2 } },
    { id: 'storage', config: { root: sessions, compression: 'none' } },
    { id: 'pi-ai', config: { providers: { fixture: { apiKeyEnv: 'NATIVE_SDK_FIXTURE_KEY', api: 'openai-completions',
      baseURL: `${controlUrl}/v1`, models: [{ id: 'fixture-model', input: ['text'] }] } } } },
  ] }))
  const harness = new DeepSeekHarness({ profile: 'native-sdk', dshBin: join(root, 'rsh/Programs/CLI/lib/bin.js'),
    dshHome: home, patches: [patch], cwd: workspace, provider: 'fixture', model: 'fixture-model',
    env: { ...process.env, NATIVE_SDK_FIXTURE_KEY: 'fixture-key', DSH_TELEMETRY_DISABLED: '1' },
    requestTimeoutMs: 20_000 })
  const serializeRun = (result: RunResult) => ({ finalResponse: result.finalResponse, events: result.events,
    notifications: result.notifications })
  try {
    let runs: Record<string, ReturnType<typeof serializeRun>>
    let goalProjection: HarnessNotification
    if (process.env.DSH_NATIVE_SDK_PYTHON !== undefined) {
      updateStage('run Python SDK Goal lifecycle')
      const launcher = join(home, process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
      writeFileSync(launcher, process.platform === 'win32'
        ? `@echo off\r\n"${process.execPath}" "${join(root, 'rsh/Programs/CLI/lib/bin.js')}" %*\r\n`
        : `#!/bin/sh\nexec "${process.execPath}" "${join(root, 'rsh/Programs/CLI/lib/bin.js')}" "$@"\n`)
      if (process.platform !== 'win32') chmodSync(launcher, 0o700)
      const python = await execa(process.env.DSH_NATIVE_SDK_PYTHON, [join(root, 'snapshots/native-sdk/text-turn/client.py'),
        launcher, home, workspace, patch, task, 'goal-control'], {
        env: { ...process.env, PYTHONPATH: join(root, 'rsh/Programs/SDK/python/sdk/src'),
          NATIVE_SDK_FIXTURE_KEY: 'fixture-key', NATIVE_SDK_GOAL_CONTROL_URL: controlUrl },
        timeout: 45_000,
      })
      const output = JSON.parse(python.stdout) as {
        runs: Record<string, ReturnType<typeof serializeRun>>; goalNotification: HarnessNotification
      }
      runs = output.runs
      goalProjection = output.goalNotification
      resultSummaries = Object.fromEntries(Object.entries(runs).map(([name, run]) => [name, run.finalResponse]))
    } else {
      const session = harness.session(sessionId)
      const tree = harness.client.subscribeSessionTree(sessionId)
      updateStage('start bootstrap SDK prompt')
      const bootstrapRun = session.run(task, { onNotification: notification => { sdkNotifications.push(notification) } })
      const bootstrapFailure = bootstrapRun.then(() => new Promise<never>(() => {}), failure => Promise.reject(failure))
      const goalClaim = (async () => {
        for (;;) {
          const notification = await tree.next()
          if (notification.method !== 'session.event' || notification.params.sessionId !== sessionId) continue
          const event = notification.params.event as { type?: string; data?: { source?: { kind?: string; round?: number } } }
          if (event.type === 'user/message' && event.data?.source?.kind === 'goal' && event.data.source.round === 1) return notification
        }
      })()
      updateStage('receive Goal event through SDK subscription')
      try { goalProjection = await waitForEvidence('receive Goal input', Promise.race([goalClaim, bootstrapFailure]), observed) }
      finally { tree.close() }
      updateStage('wait until the Goal round-1 provider request is in flight')
      await waitForEvidence('round-1 provider request start', Promise.race([goalRequestStarted.promise, bootstrapFailure]), observed)
      updateStage('persist ordinary human next-step input during the Goal request')
      const humanMessageId = await waitForEvidence('ordinary human steer receipt', session.steer(humanText), observed)
      releasePause.resolve()
      updateStage('wait for the Goal pause to settle and park the root')
      await waitForEvidence('Goal hook-aborted turn end', pauseSettledSignal.promise, observed)
      updateStage('wake the parked SDK root with a second ordinary human steer')
      const wakeMessageId = await waitForEvidence('wake human steer receipt', session.steer(wakeText), observed)
      updateStage('settle retained human inputs through the original SDK run')
      const bootstrap = await waitForEvidence('original SDK root settles after wake', bootstrapRun, observed)
      expect(bootstrap.events.some(event => event.type === 'agent/inbox/spliced'
        && event.data.inserted.some(message => message.id === humanMessageId))).toBe(true)
      expect(bootstrap.events.some(event => event.type === 'agent/inbox/spliced'
        && event.data.inserted.some(message => message.id === wakeMessageId))).toBe(true)
      updateStage('close original SDK Host')
      await harness.close()
      const restoredOptions = { ...harness.client.options, cwd: workspace, provider: 'fixture', model: 'fixture-model' }
      const restored = new DeepSeekHarness(restoredOptions)
      let cold: RunResult
      let rearmed: RunResult
      try {
        const restoredSession = restored.session(sessionId)
        updateStage('cold restored SDK admission while Goal is disarmed')
        cold = await waitForEvidence('cold restored SDK turn settles',
          restoredSession.run(coldText, { onNotification: notification => { sdkNotifications.push(notification) } }), observed)
        updateStage('explicit human Goal rearm on retained restored SDK Host')
        rearmed = await waitForEvidence('explicit human Goal rearm turn settles',
          restoredSession.run(resumeText, { onNotification: notification => { sdkNotifications.push(notification) } }), observed)
      } finally { await restored.close() }
      runs = { bootstrap: serializeRun(bootstrap), cold: serializeRun(cold),
        rearmed: serializeRun(rearmed) }
      resultSummaries = { bootstrap: bootstrap.finalResponse, cold: cold.finalResponse, rearmed: rearmed.finalResponse }
    }

    updateStage('assert native SDK projections, lifecycle and recorded evidence')
    expect(attached).toHaveLength(3)
    expect(attached[0]).toMatchObject({ sessionId, goal: { objective, phase: 'active', roundsStarted: 0 } })
    expect(attached[1]).toMatchObject({ sessionId, goal: { objective, phase: 'paused', roundsStarted: 1 } })
    expect(attached[2]).toMatchObject({ sessionId, goal: { objective, phase: 'paused', roundsStarted: 1 } })
    const liveOwner = attached[0]?.ownerToken
    const coldOwner = attached[1]?.ownerToken
    const restoredOwner = attached[2]?.ownerToken
    expect(liveOwner).toBeTypeOf('string')
    expect(new Set(attached.map(owner => owner.ownerToken)).size).toBe(3)
    expect(new Set(attached.slice(1).map(owner => owner.agentToken)).size).toBe(1)
    expect(attached[0]?.agentToken).not.toBe(attached[1]?.agentToken)
    expect(coldOwner).not.toBe(liveOwner)
    expect(restoredOwner).not.toBe(coldOwner)
    expect(humanConsumed.map(({ text }) => text)).toEqual([humanText, wakeText])
    expect(humanConsumed.map(({ ownerToken }) => ownerToken)).toEqual([liveOwner, liveOwner])
    expect(humanConsumed.map(({ agentToken }) => agentToken)).toEqual([attached[0]?.agentToken, attached[0]?.agentToken])
    expect(pauseSettled).toHaveLength(1)
    expect(pauseSettled[0]).toMatchObject({ ownerToken: liveOwner, agentToken: attached[0]?.agentToken })
    expect(humanRearmed).toHaveLength(1)
    expect(humanRearmed[0]).toMatchObject({ ownerToken: restoredOwner, agentToken: attached[2]?.agentToken,
      goal: { objective, revision: 3, phase: 'active', roundsStarted: 1, maxGoalRounds: 2, activation: 'armed' } })
    expect(goalRequestAborted).toBe(true)
    expect(pauseClaimed).toBe(true)
    expect(admissions.some(request => request.input.includes('<goal_round>') && request.round === 1
      && request.outcome === 'interrupted')).toBe(true)
    const retainedAdmission = admissions.find(request => request.input === wakeText)
    expect(retainedAdmission).toMatchObject({ retainedInputs: [humanText, wakeText], outcome: 'completed' })
    expect(admissions.some(request => request.input === coldText && request.outcome === 'completed')).toBe(true)
    expect(admissions.some(request => request.input === resumeText && request.outcome === 'completed')).toBe(true)
    expect(admissions.some(request => request.input.includes('<goal_round>') && request.round === 2
      && request.outcome === 'completed')).toBe(true)
    expect(runs.cold?.finalResponse).toBe('Cold restore admitted the human input.')
    expect(runs.bootstrap?.finalResponse).toBe('The retained input and explicit wake input were consumed.')
    expect(runs.rearmed?.finalResponse).toBe('Goal rearmed and continued.')
    const coldAdmission = admissions.findIndex(request => request.input === coldText)
    const rearmAdmission = admissions.findIndex(request => request.input === resumeText)
    expect(coldAdmission).toBeGreaterThanOrEqual(0)
    expect(rearmAdmission).toBeGreaterThan(coldAdmission)
    expect(admissions.slice(coldAdmission + 1, rearmAdmission).some(request => request.input.includes('<goal_round>')))
      .toBe(false)

    const goalProjectionEvent = goalProjection.params.event as SessionEvent
    expect(goalProjection.method).toBe('session.event')
    expect(goalProjection.params.sessionId).toBe(sessionId)
    expect(goalProjectionEvent).toMatchObject({ type: 'user/message', data: { source: {
      kind: 'goal', goalId: (attached[0]?.goal as { id?: string } | undefined)?.id, revision: 1, round: 1,
    } } })
    const sdkGoal = runs.bootstrap?.events.find(event => event.type === 'user/message'
      && event.data.source.kind === 'goal' && event.data.source.round === 1)
    expect(sdkGoal).toMatchObject({ type: 'user/message', data: { source: {
      kind: 'goal', goalId: (attached[0]?.goal as { id?: string } | undefined)?.id, revision: 1, round: 1,
    } } })
    if (sdkGoal?.type !== 'user/message') throw new Error('native SDK Goal snapshot: SDK Goal input missing')
    const bootstrapNotifications = (runs.bootstrap?.notifications ?? []).filter(notification =>
      notification.method === 'session.event' && notification.params.sessionId === sessionId)
      .map(notification => notification.params.event as SessionEvent)
    expect(bootstrapNotifications).toContainEqual(goalProjectionEvent)
    const humanEvents = runs.bootstrap?.events ?? []
    const humanNotificationEvents = (runs.bootstrap?.notifications ?? []).filter(notification =>
      notification.method === 'session.event' && notification.params.sessionId === sessionId)
      .map(notification => notification.params.event as SessionEvent)
    const projectedHumanReceipts = [humanText, wakeText].map(text => humanEvents.find(event =>
      event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.source.kind === 'user'
        && message.content.some(block => block.type === 'text' && block.text === text))))
    const projectedHumanInputs = [humanText, wakeText].map(text => humanEvents.find(event =>
      event.type === 'user/message' && event.data.source.kind === 'user' && textBlock(event) === text))
    const projectedGoalEnd = humanEvents.find(event => event.type === 'turn/end'
      && event.data.turn === turnForEvent(humanEvents, sdkGoal) && event.data.reason.kind === 'aborted'
      && event.data.reason.reason.kind === 'hook' && event.data.reason.reason.reason === 'goal-pause')
    expect(projectedHumanReceipts.every(event => event !== undefined)).toBe(true)
    expect(projectedGoalEnd).toBeDefined()
    expect(projectedHumanInputs.every(event => event !== undefined)).toBe(true)
    if (projectedHumanReceipts.some(event => event?.type !== 'agent/inbox/spliced')
      || projectedHumanInputs.some(event => event?.type !== 'user/message') || projectedGoalEnd?.type !== 'turn/end') {
      throw new Error('native SDK Goal snapshot: retained inbox projection missing')
    }
    const humanReceipt = projectedHumanReceipts[0]
    const wakeReceipt = projectedHumanReceipts[1]
    const humanInput = projectedHumanInputs[0]
    const wakeInput = projectedHumanInputs[1]
    if (humanReceipt?.type !== 'agent/inbox/spliced' || wakeReceipt?.type !== 'agent/inbox/spliced'
      || humanInput?.type !== 'user/message' || wakeInput?.type !== 'user/message') {
      throw new Error('native SDK Goal snapshot: retained inbox event narrowing failed')
    }
    const queuedHuman = humanReceipt.data.inserted.find(message => message.source.kind === 'user'
      && message.content.some(block => block.type === 'text' && block.text === humanText))
    const queuedWake = wakeReceipt.data.inserted.find(message => message.source.kind === 'user'
      && message.content.some(block => block.type === 'text' && block.text === wakeText))
    expect(queuedHuman?.id).toBe(humanInput.data.id)
    expect(queuedWake?.id).toBe(wakeInput.data.id)
    const humanTurn = turnForEvent(humanEvents, humanInput)
    const wakeTurn = turnForEvent(humanEvents, wakeInput)
    expect(humanTurn).toBeTypeOf('number')
    expect(wakeTurn).toBe(humanTurn)
    expect(humanEvents.indexOf(humanReceipt)).toBeLessThan(humanEvents.indexOf(projectedGoalEnd))
    expect(humanEvents.indexOf(projectedGoalEnd)).toBeLessThan(humanEvents.indexOf(wakeReceipt))
    expect(humanEvents.indexOf(wakeReceipt)).toBeLessThan(humanEvents.indexOf(humanInput))
    expect(humanEvents.indexOf(humanInput)).toBeLessThan(humanEvents.indexOf(wakeInput))
    expect(humanEvents).toContainEqual(expect.objectContaining({ type: 'turn/end', data: {
      turn: wakeTurn, reason: { kind: 'completed' },
    } }))
    expect(humanNotificationEvents).toContainEqual(projectedGoalEnd)
    expect(humanNotificationEvents).toContainEqual(humanReceipt)
    expect(humanNotificationEvents).toContainEqual(wakeReceipt)
    expect(humanNotificationEvents).toContainEqual(humanInput)
    expect(humanNotificationEvents).toContainEqual(wakeInput)
    expect(humanNotificationEvents).toContainEqual(expect.objectContaining({ type: 'turn/end', data: {
      turn: wakeTurn, reason: { kind: 'completed' },
    } }))

    const coldEvents = runs.cold?.events ?? []
    const projectedColdInput = coldEvents.find(event => event.type === 'user/message'
      && event.data.source.kind === 'user' && textBlock(event) === coldText)
    const projectedColdEnd = coldEvents.find(event => event.type === 'turn/end'
      && event.data.reason.kind === 'completed')
    expect(projectedColdInput).toMatchObject({ type: 'user/message', data: { source: { kind: 'user' } } })
    expect(projectedColdEnd).toBeDefined()
    expect(coldEvents.some(event => event.type === 'user/message' && event.data.source.kind === 'goal')).toBe(false)
    const coldNotificationEvents = (runs.cold?.notifications ?? []).filter(notification =>
      notification.method === 'session.event' && notification.params.sessionId === sessionId)
      .map(notification => notification.params.event as SessionEvent)
    expect(coldNotificationEvents).toContainEqual(projectedColdInput)
    expect(coldNotificationEvents).toContainEqual(projectedColdEnd)
    expect(coldNotificationEvents.some(event => event.type === 'user/message' && event.data.source.kind === 'goal'))
      .toBe(false)

    const rearmedEvents = runs.rearmed?.events ?? []
    const projectedResume = rearmedEvents.find(event => event.type === 'goal/change' && event.data.operation === 'resume')
    const projectedRoundTwo = rearmedEvents.find(event => event.type === 'user/message'
      && event.data.source.kind === 'goal' && event.data.source.round === 2)
    expect(projectedResume).toMatchObject({ type: 'goal/change', data: { operation: 'resume', roundsStarted: 1,
      goal: { revision: 3, phase: 'active' } } })
    expect(projectedRoundTwo).toMatchObject({ type: 'user/message', data: { source: {
      kind: 'goal', revision: 3, round: 2,
    } } })
    const rearmedNotificationEvents = (runs.rearmed?.notifications ?? []).filter(notification =>
      notification.method === 'session.event' && notification.params.sessionId === sessionId)
      .map(notification => notification.params.event as SessionEvent)
    expect(rearmedNotificationEvents).toContainEqual(projectedResume)
    expect(rearmedNotificationEvents).toContainEqual(projectedRoundTwo)

    const logNames = readdirSync(sessions, { recursive: true }).filter(name => String(name).endsWith('session.v3.jsonl'))
    expect(logNames).toHaveLength(1)
    const raw = readFileSync(join(sessions, String(logNames[0])), 'utf8')
    const events = parseSessionLog(raw)
    const goalInputs = events.filter(event => event.type === 'user/message' && event.data.source.kind === 'goal')
    expect(goalInputs.map(event => sourceGoal(event))).toEqual([
      expect.objectContaining({ revision: 1, round: 1 }),
      expect.objectContaining({ revision: 3, round: 2 }),
    ])
    expect(events.filter(event => event.type === 'goal/change').map(event => event.data.operation))
      .toEqual(['create', 'pause', 'resume', 'block'])
    const firstGoal = goalInputs[0]
    if (firstGoal?.type !== 'user/message') throw new Error('native SDK Goal snapshot: first Goal input missing')
    const firstGoalTurn = turnForEvent(events, firstGoal)
    const goalEndIndex = events.findIndex(event => event.type === 'turn/end'
      && event.data.turn === firstGoalTurn && event.data.reason.kind === 'aborted'
      && event.data.reason.reason.kind === 'hook' && event.data.reason.reason.reason === 'goal-pause')
    const humanReceiptIndex = events.findIndex(event => event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(message => message.source.kind === 'user'
        && message.content.some(block => block.type === 'text' && block.text === humanText)))
    const humanInputIndex = events.findIndex(event => event.type === 'user/message'
      && event.data.source.kind === 'user' && textBlock(event) === humanText)
    const wakeReceiptIndex = events.findIndex(event => event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(message => message.source.kind === 'user'
        && message.content.some(block => block.type === 'text' && block.text === wakeText)))
    const wakeInputIndex = events.findIndex(event => event.type === 'user/message'
      && event.data.source.kind === 'user' && textBlock(event) === wakeText)
    expect(goalEndIndex).toBeGreaterThan(humanReceiptIndex)
    expect(goalEndIndex).toBeLessThan(wakeReceiptIndex)
    expect(wakeReceiptIndex).toBeLessThan(humanInputIndex)
    expect(humanInputIndex).toBeGreaterThan(goalEndIndex)
    expect(wakeInputIndex).toBeGreaterThan(humanInputIndex)
    const durableHumanInput = events[humanInputIndex]
    const durableWakeInput = events[wakeInputIndex]
    if (durableHumanInput?.type !== 'user/message' || durableWakeInput?.type !== 'user/message') {
      throw new Error('native SDK Goal snapshot: durable human input projection missing')
    }
    const durableHumanTurn = turnForEvent(events, durableHumanInput)
    const durableWakeTurn = turnForEvent(events, durableWakeInput)
    expect(durableHumanTurn).toBeTypeOf('number')
    expect(durableWakeTurn).toBe(durableHumanTurn)
    expect(events.some(event => event.type === 'turn/end' && event.data.turn === firstGoalTurn
      && event.data.reason.kind === 'aborted' && event.data.reason.reason.kind === 'hook'
      && event.data.reason.reason.reason === 'goal-pause')).toBe(true)
    expect(events.some(event => event.type === 'turn/end' && event.data.turn === durableHumanTurn
      && event.data.reason.kind === 'completed')).toBe(true)
    const coldInput = events.find(event => event.type === 'user/message' && event.data.source.kind === 'user'
      && textBlock(event) === coldText)
    expect(coldInput).toMatchObject({ type: 'user/message', data: { source: { kind: 'user' } } })
    const coldInputIndex = events.indexOf(coldInput!)
    expect(events.slice(0, coldInputIndex).filter(event => event.type === 'user/message'
      && event.data.source.kind === 'goal')).toHaveLength(1)
    expect(events.filter(event => event.type === 'user/message' && event.data.source.kind === 'goal')).toHaveLength(2)
    const resumeChange = events.find(event => event.type === 'goal/change' && event.data.operation === 'resume')
    expect(resumeChange).toMatchObject({ data: { goal: { id: sourceGoal(firstGoal)?.goalId, revision: 3,
      maxGoalRounds: 2, phase: 'active' }, roundsStarted: 1 } })

    for (const label of ['bootstrap', 'cold', 'rearmed']) {
      expect(runs[label]?.events.length, `native SDK Goal snapshot: ${label} projection`).toBeGreaterThan(0)
      expect(runs[label]?.notifications.some(notification => notification.method === 'session.event'
        && notification.params.sessionId === sessionId)).toBe(true)
    }
    expect(goalChanges.map(value => (value.event as { data?: { operation?: string } }).data?.operation))
      .toEqual(['create', 'pause', 'resume', 'block'])

    const redacted = redactSessionSnapshotIds([raw])[0] ?? raw
    const normalized = normalizeSessionSnapshot(redacted, { sessionIds: [], cwd: workspace }, { identityMode: 'preserve' })
    const prompts = normalizedSystemPrompts(raw, { sessionIds: [], cwd: workspace })
    const schemas = normalizedToolSchemas(raw, { sessionIds: [], cwd: workspace })
    if (prompts[0] === undefined || schemas[0] === undefined) {
      throw new Error('native SDK Goal snapshot: model request header missing')
    }
    const prompt = formatSystemPromptSnapshot(prompts[0], prompts.slice(1))
    const toolSchemas = formatToolSchemasSnapshot(schemas[0], schemas.slice(1))
    const modelEvidence = `${JSON.stringify(admissions.map(({ input, round, outcome, retainedInputs }) => ({
      input, round: round ?? null, outcome, retainedInputs,
    })), null, 2)}\n`
    if (process.env.DSH_SNAPSHOT === 'refresh') {
      writeFileSync(fixture, normalized)
      writeFileSync(join(scenario, 'system-prompt.expected.md'), prompt)
      writeFileSync(join(scenario, 'tool-schemas.expected.json'), toolSchemas)
      writeFileSync(join(scenario, 'model-admissions.expected.json'), modelEvidence)
    } else {
      expect(normalized).toBe(readFileSync(fixture, 'utf8'))
      expect(prompt).toBe(readFileSync(join(scenario, 'system-prompt.expected.md'), 'utf8'))
      expect(toolSchemas).toBe(readFileSync(join(scenario, 'tool-schemas.expected.json'), 'utf8'))
      expect(modelEvidence).toBe(readFileSync(join(scenario, 'model-admissions.expected.json'), 'utf8'))
    }
  } catch (failure) {
    primaryFailure = failure
    const clientDiagnostics = harness.client as unknown as { stderrTail?: string[] }
    const diagnostic = { stage, cause: errorDetails(failure),
      cliStderrTail: clientDiagnostics.stderrTail ?? [], serverFailures: serverFailures.map(errorDetails),
      sdkNotifications: sdkNotifications.map(notification => ({ method: notification.method,
        sessionId: notification.params.sessionId,
        ...(notification.method === 'session.event'
          ? { event: notification.params.event as SessionEvent } : { params: notification.params }) })),
      requests: admissions, resultSummaries, attached, goalChanges, humanConsumed, pauseSettled, pauseStages, humanRearmed,
      goalRequestAborted, pauseClaimed }
    const evidenceRoot = join(root, 'output/snapshot-debug/goal-control')
    const evidenceDir = join(evidenceRoot, `failure-${new Date().toISOString().replaceAll(':', '-')}`)
    mkdirSync(evidenceDir, { recursive: true })
    writeFileSync(join(evidenceDir, 'diagnostic.json'), `${JSON.stringify(diagnostic, null, 2)}\n`)
    if (existsSync(sessions)) {
      for (const name of readdirSync(sessions, { recursive: true }).filter(value => String(value).endsWith('session.v3.jsonl'))) {
        const source = join(sessions, String(name))
        writeFileSync(join(evidenceDir, `session-${readdirSync(evidenceDir).length}.v3.jsonl`), readFileSync(source))
      }
    }
    process.stderr.write(`native SDK Goal snapshot failure evidence: ${evidenceDir}\n`)
    process.stderr.write(`native SDK Goal snapshot failure: ${JSON.stringify(diagnostic)}\n`)
    throw failure
  } finally {
    releasePause.resolve()
    goalRequestStarted.resolve()
    pauseSettledSignal.resolve({})
    const cleanupFailures: unknown[] = []
    try { await harness.close() } catch (failure) { cleanupFailures.push(failure) }
    try { await new Promise<void>((resolve, reject) => server.close(failure => failure ? reject(failure) : resolve())) }
    catch (failure) { cleanupFailures.push(failure) }
    try { rmSync(home, { recursive: true, force: true }) } catch (failure) { cleanupFailures.push(failure) }
    if (cleanupFailures.length > 0) throw new AggregateError(
      [...(primaryFailure === undefined ? [] : [primaryFailure]), ...cleanupFailures],
      'native SDK Goal snapshot: cleanup failed')
  }
  }, 90_000)

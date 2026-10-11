/** Captured-generation subagent cancellation settles PTC work in a cold-readable Native Session. */
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizedSystemPrompts, normalizedToolSchemas,
  normalizeSessionSnapshot, redactSessionSnapshotIds, sessionFixtureName, sessionFixtureNames } from '@deepseek-ai/dsh-session-snapshot'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'
import { normalizeWorkspacePaths } from './external-operation/fixtures/workspace-paths.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scenario = join(root, 'snapshots/native-headless/ptc-external-cancel')
const fixtureOutput = join(scenario, sessionFixtureName(0, SESSION_FORMAT_VERSION))
const bin = join(root, 'rsh/Programs/CLI/lib/bin.js')
const contextProbe = pathToFileURL(join(root, 'rsh/Programs/CLI/tests/fixtures/deny-cordis-context-register.mjs')).href
const task = 'Delegate a nested task through the external child and cancel it during the nested request.'

function normalizeEmbeddedRequestBodies(raw: string, cwd: string): string {
  return raw.split('\n').map(line => {
    if (line.trim().length === 0) return line
    const record = JSON.parse(line) as Record<string, unknown>
    if (record.type === 'subagent/external-operation' && record.data !== null && typeof record.data === 'object') {
      const data = record.data as Record<string, unknown>
      if (data.kind === 'model-request' && typeof data.requestBody === 'string') {
        data.requestBody = JSON.stringify(normalizeWorkspacePaths(JSON.parse(data.requestBody), cwd))
      }
    }
    return JSON.stringify(record)
  }).join('\n')
}

function installFixturePackage(profileModules: string, packageName: string, source: string, provides: string[]): string {
  const directory = join(profileModules, packageName)
  mkdirSync(directory)
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: packageName, type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides } },
  }))
  writeFileSync(join(directory, 'native.mjs'), readFileSync(source, 'utf8'))
  return directory
}

it('records and cold-replays PTC cancellation through a captured external Responses generation', async () => {
  if (!existsSync(bin)) throw new Error('build the shipped dsh CLI before running ptc-external-cancel snapshot')
  const mode = process.env.DSH_SNAPSHOT
  const fixtureNames = readdirSync(scenario).filter(name => name.startsWith('session') && name.endsWith('.jsonl'))
  const selectedFixture = fixtureNames.length === 0 ? undefined : sessionFixtureNames(fixtureNames)[0]
  const fixture = selectedFixture === undefined ? fixtureOutput : join(scenario, selectedFixture)
  const recorded = mode === 'record' ? undefined
    : existsSync(fixture) ? parseSessionLog(readFileSync(fixture, 'utf8')) : undefined
  if (recorded === undefined && mode !== 'record') {
    throw new Error('ptc-external-cancel replay requires its highest recorded Session JSONL')
  }
  const initial = recorded?.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const recordedTask = initial?.type === 'user/message' ? initial.data.content[0] : undefined
  if (recorded !== undefined && recordedTask?.type !== 'text') {
    throw new Error('ptc-external-cancel canonical Session omitted its user task')
  }
  const replayTask = recordedTask?.type === 'text' ? recordedTask.text : task
  const rootScript = recorded === undefined ? undefined : deriveReplayScript(recorded)
  const operationScript = recorded?.flatMap(event => event.type === 'subagent/external-operation' ? [event.data] : [])
  const signals: Array<'SIGTERM' | 'SIGINT' | undefined> = process.platform === 'win32' ? [undefined] : ['SIGTERM', 'SIGINT']
  for (const signal of signals) {
    const base = mkdtempSync(join(tmpdir(), '.dsh-native-ptc-external-cancel-'))
    const home = join(base, 'home')
    const profile = join(home, 'profiles/native-headless')
    const profileModules = join(profile, 'node_modules')
    const workspace = join(home, 'work')
    const sessions = join(home, 'sessions')
    const audit = join(home, 'lifecycle.jsonl')
    const links: string[] = []
    let child: ReturnType<typeof execa> | undefined
    let childSettled = true
    let childFailure: unknown
    let runFailed = false
    let runFailure: unknown
    try {
      mkdirSync(home)
      mkdirSync(profile, { recursive: true })
      mkdirSync(workspace)
      mkdirSync(join(profileModules, '@deepseek-ai'), { recursive: true })
      writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'native-ptc-external-cancel-profile', private: true,
        dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } }))

      for (const [name, path] of [
        ['dsh-native-headless', 'rsh/Engine/core/native-headless'],
        ['dsh-native-agent', 'rsh/Engine/core/native-agent'],
        ['dsh-native-tools', 'rsh/Engine/core/native-tools'],
        ['dsh-native-model-execution', 'rsh/Engine/core/native-model-execution'],
        ['dsh-native-session-execution', 'rsh/Engine/core/native-session-execution'],
        ['dsh-native-prompt', 'rsh/Engine/core/native-prompt'],
        ['dsh-native-subagent', 'rsh/Engine/subagent/native-subagent'],
        ['dsh-tool-subagent', 'rsh/Engine/subagent/tool-subagent'],
        ['dsh-session-persistence-jsonl', 'rsh/Engine/session/session-persistence-jsonl'],
        ['dsh-fs-local', 'rsh/Modules/Official/fs/fs-local'],
        ['dsh-fs-observation-policy', 'rsh/Modules/Official/fs/fs-observation-policy'],
        ['dsh-native-sandbox-policy', 'rsh/Modules/Official/sandbox/native-sandbox-policy'],
        ['dsh-subprocess-local', 'rsh/Core/subprocess/subprocess-local'],
        ['dsh-sandbox-local', 'rsh/Modules/Official/sandbox/sandbox-local'],
        ['dsh-code-runtime-process-sandbox', 'rsh/Modules/Official/code-runtime/code-runtime-process-sandbox'],
        ['dsh-tool-code-runtime', 'rsh/Modules/Official/code-runtime/tool-code-runtime'],
      ] as const) {
        const link = join(profileModules, '@deepseek-ai', name)
        symlinkSync(join(root, path), link, 'junction')
        links.push(link)
      }
      installFixturePackage(profileModules, 'native-ptc-external-cancel-model',
        join(scenario, 'fixtures/model.mjs'), ['model'])
      const driverDirectory = installFixturePackage(profileModules, 'native-ptc-external-cancel-driver',
        join(scenario, 'fixtures/driver.mjs'), ['externalSubagentDriver'])
      copyFileSync(join(root, 'snapshots/native-headless/external-operation/fixtures/workspace-paths.mjs'),
        join(driverDirectory, 'workspace-paths.mjs'))

      const composition = shippedNativeProfileComposition(home, 'native-headless')
      const selected = new Set(['app', 'agents', 'session-execution', 'tools', 'model-execution', 'prompt', 'subagents', 'storage',
        'sandbox-policy', 'fs', 'policy', 'subprocess', 'sandbox', 'code-runtime', 'pi-ai'])
      const installations = composition.installations.map(row => {
        if (!selected.has(row.id)) return { ...row, disabled: true }
        if (row.id === 'app') return { ...row, config: { cwd: workspace, provider: 'fixture', model: 'fixture',
          systemPrompt: 'Delegate nested work through run_code and stop cleanly when it is cancelled.', maxSteps: 3, builtinTools: false } }
        if (row.id === 'subagents') return { ...row, config: { providerName: 'ptc-cancel-fixture' } }
        if (row.id === 'storage') return { ...row, config: { root: sessions, compression: 'none' } }
        if (row.id === 'sandbox-policy') return { ...row, config: { mode: 'workspace-write', workspaceRoot: workspace } }
        if (row.id === 'fs') return { ...row, plugin: '@deepseek-ai/dsh-fs-local', config: { cwd: workspace } }
        if (row.id === 'pi-ai') return { ...row, plugin: 'native-ptc-external-cancel-model',
          config: { audit, signalMode: signal === undefined ? 'handler-only' : 'parent-os-signal',
            ...(rootScript === undefined ? {} : { rootScript }),
            ...(operationScript === undefined ? {} : { operationScript }) } }
        return row
      })
      const subagentIndex = installations.findIndex(row => row.id === 'subagents')
      if (subagentIndex < 0) throw new Error('native-headless template omitted NativeSubagent')
      installations.splice(subagentIndex, 0, { id: 'ptc-cancel-driver', plugin: 'native-ptc-external-cancel-driver', scope: 'root',
        config: { audit, ...(operationScript === undefined ? {} : { operationScript }) } })
      installations.push({ id: 'code-tool', plugin: '@deepseek-ai/dsh-tool-code-runtime', scope: 'root',
        config: { sdkPrompt: true, maxParallelSubCalls: 2 } })
      installations.push({ id: 'subagent-tool', plugin: '@deepseek-ai/dsh-tool-subagent', scope: 'root',
        config: { toolName: 'subagent', maxDepth: 2 } })
      writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ ...composition, installations }))

      child = execa(process.execPath, [
        '--import', contextProbe, bin, '--profile', 'native-headless', replayTask,
      ], { env: { ...process.env, DSH_HOME: home }, reject: false, timeout: 45_000 })
      childSettled = false
      void child.then(() => { childSettled = true }, error => {
        childSettled = true
        childFailure = error
      })
      if (signal !== undefined) {
        const deadline = Date.now() + 10_000
        while (!existsSync(audit) || !readFileSync(audit, 'utf8').split(/\r?\n/).includes('forward-enter:2')) {
          if (childFailure !== undefined) throw childFailure
          if (childSettled) throw new Error('ptc-external-cancel: child exited before nested Responses readiness')
          if (Date.now() >= deadline) throw new Error('ptc-external-cancel: timed out waiting for nested Responses readiness')
          await new Promise(resolve => setTimeout(resolve, 20))
        }
        if (childSettled) throw new Error('ptc-external-cancel: child exited before parent signal delivery')
        expect(child.kill(signal)).toBe(true)
      }
      const childResult = await child
      expect(childResult.exitCode, childResult.stderr).toBe(signal === 'SIGINT' ? 130 : 0)
      expect(childResult.signal).toBeUndefined()

      const storage = new JsonlSessionBackend({ root: sessions, compression: 'none' })
      try {
        const stored = await storage.list()
        expect(stored).toHaveLength(1)
        const id = stored[0]?.header.id
        if (id === undefined) throw new Error('ptc-external-cancel cold Session omitted its identity')
        const reader = await storage.open(id, 'read')
        let raw: string
        try {
          const events = (await reader.read()).events
          const ptcStarts = events.filter(event => event.type === 'tool/ptc-dispatch-start')
          const ptcSettlements = events.filter(event => event.type === 'tool/ptc-dispatch')
          const externalStarts = events.filter(event => event.type === 'subagent/external-start')
          const externalEnds = events.filter(event => event.type === 'subagent/external-end')
          const operations = events.filter(event => event.type === 'subagent/external-operation')
          expect(ptcStarts).toHaveLength(1)
          expect(ptcSettlements).toHaveLength(1)
          expect(ptcSettlements[0]?.data).toMatchObject({ subCallId: ptcStarts[0]?.data.subCallId, isError: true })
          expect(externalStarts).toHaveLength(2)
          expect(externalEnds).toHaveLength(2)
          expect(new Set(externalEnds.map(event => event.data.id))).toEqual(new Set(externalStarts.map(event => event.data.id)))
          expect(externalEnds.every(event => event.data.stopReason === 'aborted')).toBe(true)
          const rootOperation = externalStarts[0]?.data.id
          const nestedOperation = externalStarts[1]?.data.id
          if (rootOperation === undefined || nestedOperation === undefined) {
            throw new Error('ptc-external-cancel Session omitted one external child identity')
          }
          const rootFacts = operations.filter(event => event.data.id === rootOperation)
          const nestedFacts = operations.filter(event => event.data.id === nestedOperation)
          expect(rootFacts.map(event => event.data.kind)).toEqual([
            'model-request', 'model-response', 'tool-call',
          ])
          expect(nestedFacts.map(event => event.data.kind)).toEqual(['model-request', 'model-failure'])
          const ptcStart = ptcStarts[0]
          const ptcSettlement = ptcSettlements[0]
          const nestedStart = externalStarts[1]
          const nestedFailure = nestedFacts.find(event => event.data.kind === 'model-failure')
          const nestedEnd = externalEnds.find(event => event.data.id === nestedOperation)
          if (ptcStart === undefined || ptcSettlement === undefined || nestedStart === undefined
            || nestedFailure === undefined || nestedEnd === undefined) {
            throw new Error('ptc-external-cancel Session omitted a settlement or nested cancellation fact')
          }
          expect(ptcStart.seq).toBeLessThan(nestedStart.seq)
          expect(nestedStart.seq).toBeLessThan(nestedFailure.seq)
          expect(nestedFailure.seq).toBeLessThan(nestedEnd.seq)
          expect(nestedEnd.seq).toBeLessThan(ptcSettlement.seq)
          const outerEnd = externalEnds.find(event => event.data.id === rootOperation)
          if (outerEnd === undefined) throw new Error('ptc-external-cancel Session omitted the outer child end')
          expect(ptcSettlement.seq).toBeLessThan(outerEnd.seq)
          const auditLines = readFileSync(audit, 'utf8').trim().split('\n')
          expect(auditLines.filter(line => line.startsWith('prepare:'))).toEqual(['prepare:1'])
          expect(auditLines.filter(line => line.startsWith('capture:'))).toEqual(['capture:1:1', 'capture:1:2'])
          const turnStarts = events.filter(event => event.type === 'turn/start')
          const turnEnds = events.filter(event => event.type === 'turn/end')
          expect(turnStarts).toHaveLength(1)
          expect(turnEnds).toHaveLength(1)
          expect(turnEnds[0]?.data).toMatchObject({ turn: turnStarts[0]?.data.turn, reason: { kind: 'aborted' } })
          expect(auditLines).toContain('transport-close:2')
          for (const ordinal of [1, 2]) {
            expect(auditLines.indexOf(`product-dispose-end:${ordinal}`)).toBeGreaterThanOrEqual(0)
            expect(auditLines.indexOf(`product-dispose-end:${ordinal}`))
              .toBeLessThan(auditLines.indexOf(`transport-close:${ordinal}`))
          }
          const storedName = readdirSync(sessions, { recursive: true })
            .find(name => String(name).endsWith(sessionFixtureName(0, SESSION_FORMAT_VERSION)))
          if (storedName === undefined) throw new Error('ptc-external-cancel writer omitted current Session JSONL')
          raw = readFileSync(join(sessions, String(storedName)), 'utf8')
        } finally { await reader.close() }
        const context = { sessionIds: stored.map(item => item.header.id), cwd: workspace }
        const embedded = normalizeEmbeddedRequestBodies(raw, workspace)
        const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([embedded])[0] ?? embedded, context,
          { identityMode: 'preserve' })
        const prompts = normalizedSystemPrompts(raw, context)
        const schemas = normalizedToolSchemas(raw, context)
        if (prompts[0] === undefined || schemas[0] === undefined) {
          throw new Error('ptc-external-cancel Session omitted its request header')
        }
        if (mode === 'record' || mode === 'refresh') {
          writeFileSync(fixtureOutput, normalized)
          writeFileSync(join(scenario, 'system-prompt.expected.md'), formatSystemPromptSnapshot(prompts[0], prompts.slice(1)))
          writeFileSync(join(scenario, 'tool-schemas.expected.json'), formatToolSchemasSnapshot(schemas[0], schemas.slice(1)))
        } else {
          expect(normalized).toBe(readFileSync(fixture, 'utf8'))
          expect(formatSystemPromptSnapshot(prompts[0], prompts.slice(1)))
            .toBe(readFileSync(join(scenario, 'system-prompt.expected.md'), 'utf8'))
          expect(formatToolSchemasSnapshot(schemas[0], schemas.slice(1)))
            .toBe(readFileSync(join(scenario, 'tool-schemas.expected.json'), 'utf8'))
        }
      } finally { await storage.close() }
    } catch (error) {
      runFailed = true
      runFailure = error
      throw error
    } finally {
      const cleanupFailures: unknown[] = []
      if (child !== undefined && !childSettled) {
        try {
          child.kill('SIGKILL')
          await child
        } catch (error) { cleanupFailures.push(error) }
      }
      try {
        const status = lstatSync(base)
        if (!status.isDirectory() || status.isSymbolicLink() || !basename(base).startsWith('.dsh-native-ptc-external-cancel-')
          || dirname(realpathSync(base)) !== realpathSync(tmpdir()) || realpathSync(base) !== resolve(base)) {
          throw new Error('ptc-external-cancel: unsafe temporary base')
        }
        for (const link of links) unlinkSync(link)
        rmSync(base, { recursive: true, force: true })
      } catch (error) { cleanupFailures.push(error) }
      if (cleanupFailures.length > 0) {
        const failures = runFailed ? [runFailure, ...cleanupFailures] : cleanupFailures
        if (failures.length === 1) throw failures[0]
        throw new AggregateError(failures, 'ptc-external-cancel and cleanup failed')
      }
    }
  }
}, 60_000)

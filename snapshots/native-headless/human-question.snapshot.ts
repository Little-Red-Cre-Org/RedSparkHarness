/** Shipped dsh profile records a broker answer and replays the following model request. */
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizeSessionSnapshot, redactSessionSnapshotIds,
  normalizedSystemPrompts, normalizedToolSchemas, sessionFixtureName } from '@deepseek-ai/dsh-session-snapshot'
import { ensureShippedNativeProfile, shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scenario = join(root, 'snapshots/native-headless/human-question')
const fixture = join(scenario, sessionFixtureName(0, SESSION_FORMAT_VERSION))

it('replays a human answer through the shipped native-headless profile and durable Session', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const initial = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (initial?.type !== 'user/message' || initial.data.content[0]?.type !== 'text') throw new Error('human-question: missing task')
  const home = mkdtempSync(join(tmpdir(), 'dsh-human-question-'))
  const workspace = join(home, 'work')
  const sessions = join(home, 'sessions')
  const patch = join(home, 'question.patch.json')
  const links: string[] = []
  try {
    ensureShippedNativeProfile('native-headless', home)
    const modules = join(home, 'profiles/native-headless/node_modules')
    mkdirSync(join(modules, '@deepseek-ai'), { recursive: true })
    mkdirSync(workspace)
    for (const [name, path] of [
      ['native-headless', 'rsh/Engine/core/native-headless'], ['native-agent', 'rsh/Engine/core/native-agent'],
      ['native-tools', 'rsh/Engine/core/native-tools'], ['native-model-execution', 'rsh/Engine/core/native-model-execution'],
      ['native-session-execution', 'rsh/Engine/core/native-session-execution'],
      ['session-persistence-jsonl', 'rsh/Engine/session/session-persistence-jsonl'], ['fs-local', 'rsh/Modules/Official/fs/fs-local'],
      ['fs-observation-policy', 'rsh/Modules/Official/fs/fs-observation-policy'],
      ['user-questions', 'rsh/Modules/Official/interaction/user-questions'],
      ['user-question-broker', 'rsh/Modules/Official/interaction/user-question-broker'],
      ['tool-ask-user', 'rsh/Modules/Official/interaction/tool-ask-user'],
    ] as const) {
      const link = join(modules, '@deepseek-ai', `dsh-${name}`)
      symlinkSync(join(root, path), link, 'junction')
      links.push(link)
    }
    const model = join(modules, 'question-fixture-model')
    mkdirSync(model)
    writeFileSync(join(model, 'package.json'), JSON.stringify({ name: 'question-fixture-model', type: 'module',
      exports: { './native': './native.mjs', './package.json': './package.json' },
      dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['userQuestionBroker'], optional: [], provides: ['model'] } } }))
    writeFileSync(join(model, 'native.mjs'), `export const plugin = {
      apiVersion: 1, name: 'question-fixture-model', targets: ['host'], requires: ['userQuestionBroker'], provides: ['model'],
      resolve: input => context => {
        const broker = context.require('userQuestionBroker');
        context.effect(broker.onRequest(pending => broker.answer(pending.id, pending.request.agent,
          { answers: [{ id: 'decision', selected: ['Yes'] }] })));
        let index = 0;
        context.provide('model', { async *stream(request) {
          if (index === 1 && !JSON.stringify(request.messages).includes('Yes')) throw new Error('answer missing from model request');
          const entry = input.script[index++];
          if (entry?.kind !== 'chunks') throw new Error('question replay exhausted');
          for (const chunk of entry.chunks) yield chunk;
        } });
      }
    };`)
    const keep = new Set(['app', 'agents', 'tools', 'model-execution', 'storage', 'fs', 'policy'])
    const composition = shippedNativeProfileComposition(home, 'native-headless')
    writeFileSync(join(home, 'profiles/native-headless/rsh.profile.json'), JSON.stringify({ ...composition, installations: [
      ...composition.installations.filter(row => keep.has(row.id)).map(row => row.id === 'fs' ? { ...row, plugin: '@deepseek-ai/dsh-fs-local' } : row),
      { id: 'session-execution', plugin: '@deepseek-ai/dsh-native-session-execution', scope: 'root' },
      { id: 'questions', plugin: '@deepseek-ai/dsh-user-questions', scope: 'root' },
      { id: 'broker', plugin: '@deepseek-ai/dsh-user-question-broker', scope: 'root' },
      { id: 'question-tool', plugin: '@deepseek-ai/dsh-tool-ask-user', scope: 'root' },
      { id: 'model', plugin: 'question-fixture-model', scope: 'root', config: { script: deriveReplayScript(recorded) } },
    ] }))
    writeFileSync(patch, JSON.stringify({ formatVersion: 1, installations: [
      { id: 'app', config: { cwd: workspace, provider: 'mock', model: 'fixture', systemPrompt: 'Ask the human before continuing.', maxSteps: 3 } },
      { id: 'fs', config: { cwd: workspace } },
      { id: 'tools', config: { mode: 'native' } },
    ] }))
    const child = await execa(process.execPath, ['--import', pathToFileURL(join(root, 'rsh/Programs/CLI/tests/fixtures/deny-cordis-context-register.mjs')).href,
      join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-headless', '--patch', patch, initial.data.content[0].text],
    { env: { ...process.env, DSH_HOME: home }, reject: false, timeout: 30_000 })
    expect(child.exitCode, child.stderr).toBe(0)
    expect(child.stdout).toBe('answered')
    const storage = new JsonlSessionBackend({ root: sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('human-question: no Session')
      const reader = await storage.open(id, 'read')
      try {
        const results = (await reader.read()).events.filter(event => event.type === 'tool/result')
        expect(results).toHaveLength(1)
        expect(JSON.stringify(results)).toContain('Yes')
      } finally { await reader.close() }
    } finally { await storage.close() }
    const name = readdirSync(sessions, { recursive: true }).find(name => String(name).endsWith(sessionFixtureName(0, SESSION_FORMAT_VERSION)))
    if (name === undefined) throw new Error('human-question: no Session JSONL')
    const raw = readFileSync(join(sessions, String(name)), 'utf8')
    const context = { sessionIds: [], cwd: workspace }
    const prompts = normalizedSystemPrompts(raw, context)
    const schemas = normalizedToolSchemas(raw, context)
    if (prompts[0] === undefined || schemas[0] === undefined) throw new Error('human-question: no model header')
    for (const [path, value] of [
      [fixture, normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw, context, { identityMode: 'preserve' })],
      [join(scenario, 'system-prompt.expected.md'), formatSystemPromptSnapshot(prompts[0], prompts.slice(1))],
      [join(scenario, 'tool-schemas.expected.json'), formatToolSchemasSnapshot(schemas[0], schemas.slice(1))],
    ] as const) {
      if (process.env.DSH_SNAPSHOT === 'refresh') writeFileSync(path, value)
      else expect(value).toBe(readFileSync(path, 'utf8'))
    }
  } finally {
    const status = lstatSync(home)
    if (!status.isDirectory() || status.isSymbolicLink() || dirname(realpathSync(home)) !== realpathSync(tmpdir())) throw new Error('human-question: unsafe temporary home')
    for (const link of links) if (!lstatSync(link).isSymbolicLink()) throw new Error('human-question: expected package link')
    for (const link of links) unlinkSync(link)
    rmSync(home, { recursive: true, force: true })
  }
})

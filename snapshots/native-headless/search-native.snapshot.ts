/** Shipped native search tools, complete-result recovery and durable model-visible replay. */
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { expect, it } from 'vitest'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizeSessionSnapshot, redactSessionSnapshotIds,
  normalizedSystemPrompts, normalizedToolSchemas } from '@deepseek-ai/dsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/native-headless/search-native')

it('records capped real searches with complete recovery artifacts and cold-replays the same results', async () => {
  const fixture = join(scene, 'session.v3.jsonl')
  const recorded = existsSync(fixture) ? parseSessionLog(readFileSync(fixture, 'utf8')) : undefined
  const initial = recorded?.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const task = initial?.type === 'user/message' && initial.data.content[0]?.type === 'text'
    ? initial.data.content[0].text : 'Discover data files, search first and second lines, then recover the full capped result.'
  const script = recorded === undefined ? undefined : deriveReplayScript(recorded)
  const home = mkdtempSync(join(tmpdir(), 'dsh-search-native-'))
  const profile = join(home, 'profiles/native-headless')
  const modules = join(profile, 'node_modules')
  const workspace = join(home, 'work')
  const sessions = join(home, 'sessions')
  const audit = join(home, 'audit.jsonl')
  const links: string[] = []
  mkdirSync(join(modules, '@deepseek-ai'), { recursive: true })
  mkdirSync(workspace)
  writeFileSync(join(workspace, 'a.data'), 'first\nsecond\n')
  writeFileSync(join(workspace, 'b.data'), 'other\n')
  utimesSync(join(workspace, 'a.data'), 1_000, 2_000)
  utimesSync(join(workspace, 'b.data'), 1_000, 1_000)
  const packages = [
    ['dsh-native-headless', 'rsh/Engine/core/native-headless'], ['dsh-native-agent', 'rsh/Engine/core/native-agent'],
    ['dsh-native-tools', 'rsh/Engine/core/native-tools'], ['dsh-native-model-execution', 'rsh/Engine/core/native-model-execution'],
    ['dsh-session-persistence-jsonl', 'rsh/Engine/session/session-persistence-jsonl'],
    ['dsh-fs-local', 'rsh/Modules/Official/fs/fs-local'], ['dsh-fs-observation-policy', 'rsh/Modules/Official/fs/fs-observation-policy'],
    ['dsh-tool-fs-search', 'rsh/Modules/Official/fs/tool-fs-search'],
    ['dsh-subprocess-local', 'rsh/Core/subprocess/subprocess-local'],
    ['dsh-native-prompt', 'rsh/Engine/core/native-prompt'],
    ['dsh-spill-local', 'rsh/Modules/Official/spill/spill-local'],
  ] as const
  for (const [name, path] of packages) {
    const link = join(modules, '@deepseek-ai', name)
    symlinkSync(join(root, path), link, 'junction'); links.push(link)
  }
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'native-headless-profile', private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } }))
  const composition = shippedNativeProfileComposition(home, 'native-headless')
  // This module scene selects the shipped rows it exercises; other P4 capabilities have separate acceptance owners.
  const selected = new Set(['app', 'agents', 'tools', 'model-execution', 'storage', 'fs', 'policy', 'search-tools', 'subprocess', 'spill-store', 'prompt', 'pi-ai'])
  const installations = composition.installations.map((row) => {
    if (!selected.has(row.id)) return { ...row, disabled: true }
    if (row.id === 'app') return { ...row, config: {
      cwd: workspace, provider: 'mock', model: 'search', systemPrompt: 'Use glob and grep for file discovery.', maxSteps: 3,
    } }
    if (row.id === 'tools') return { ...row, config: { mode: 'native' } }
    if (row.id === 'fs') return { ...row, plugin: '@deepseek-ai/dsh-fs-local', config: { cwd: workspace } }
    if (row.id === 'search-tools') return { ...row, config: { sampleOverCapGlobResults: false, globMaxResults: 1, grepMaxMatches: 1 } }
    if (row.id === 'spill-store') return { ...row, config: { root: join(workspace, '.spill'), cleanupPeriodDays: 0 } }
    if (row.id === 'pi-ai') return { id: row.id, scope: row.scope, plugin: 'search-model' }
    return row
  })
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ ...composition, installations }))
  const model = join(modules, 'search-model'); mkdirSync(model)
  writeFileSync(join(model, 'package.json'), JSON.stringify({ name: 'search-model', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model'] } },
  }))
  writeFileSync(join(model, 'native.mjs'), `import { appendFileSync } from 'node:fs';
export const plugin = { apiVersion: 1, name: 'search-model', targets: ['host'], requires: [], provides: ['model'],
 resolve: () => context => { let step = 0; context.provide('model', { async *stream(request) {
  appendFileSync(${JSON.stringify(audit)}, JSON.stringify(request.messages) + '\\n');
  const recorded = ${JSON.stringify(script)};
  const names = ['glob', 'grep', 'grep'];
  const argumentsList = [{ pattern: '*.data' }, { pattern: 'first|second', path: 'a.data' }];
  const args = argumentsList[step];
  if (recorded !== undefined) {
   const entry = recorded[step++];
   if (entry?.kind !== 'chunks') throw new Error('search replay exhausted');
   for (const chunk of entry.chunks) yield chunk.type === 'block-end' && chunk.block.type === 'tool-call'
    ? { ...chunk, block: { ...chunk.block, arguments: JSON.stringify(args) } } : chunk;
  } else if (step < 2) {
   yield { type: 'block-start', index: 0, blockType: 'tool-call' };
   yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'search-' + (step + 1), name: names[step++], arguments: JSON.stringify(args) } };
   yield { type: 'finish', reason: { kind: 'tool-calls' } };
  } else {
   yield { type: 'block-start', index: 0, blockType: 'text' };
   yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Complete results were saved for recovery.' } };
   yield { type: 'finish', reason: { kind: 'stop' } };
  }
 } }) } }`)
  try {
    const child = await execa(process.execPath, ['--import', pathToFileURL(join(root,
      'rsh/Programs/CLI/tests/fixtures/deny-cordis-context-register.mjs')).href,
      join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-headless', task],
    { env: { ...process.env, DSH_HOME: home }, reject: false, timeout: 30_000 })
    expect(child.timedOut).toBe(false)
    expect(child.exitCode, child.stderr).toBe(0)
    const requests = readFileSync(audit, 'utf8').trim().split('\n')
    expect(requests).toHaveLength(3)
    expect(requests[1]).toContain('Showing 1 of 2 paths')
    expect(requests[2]).toContain('Found 1 of 2 matches')
    const backend = new JsonlSessionBackend({ root: sessions, compression: 'none' })
    try {
      const id = (await backend.list())[0]?.header.id
      if (id === undefined) throw new Error('search-native: missing Session')
      const reader = await backend.open(id, 'read')
      try {
        const events = (await reader.read()).events
        const results = events.filter(event => event.type === 'tool/result')
        expect(results).toHaveLength(2)
        expect(results.every(event => event.data.message.content.every(block => block.type !== 'tool-result' || !block.isError))).toBe(true)
        expect(results[0]?.data.meta).toMatchObject({ shape: 'paths', truncated: true, total: 2 })
        expect(results[1]?.data.meta).toMatchObject({ shape: 'matches', truncated: true, total: 2 })
        for (const event of results.slice(0, 2)) {
          const body = event.data.message.content.flatMap(block => block.type === 'tool-result' ? block.content : [])
            .filter(block => block.type === 'text').map(block => block.text).join('')
          const locator = /stored at: (.+?)\. Use read/.exec(body)?.[1]
          if (locator === undefined) throw new Error('search-native: missing full-result locator')
          expect(readFileSync(locator, 'utf8')).toContain(event === results[0] ? 'b.data' : 'second')
        }
      } finally { await reader.close() }
    } finally { await backend.close() }
    const file = readdirSync(sessions, { recursive: true }).find(name => String(name).endsWith('session.v3.jsonl'))
    if (file === undefined) throw new Error('search-native: missing Session file')
    const raw = readFileSync(join(sessions, String(file)), 'utf8')
    const context = { sessionIds: [], cwd: workspace }
    const prompts = normalizedSystemPrompts(raw, context); const schemas = normalizedToolSchemas(raw, context)
    const outputs = {
      'session.v3.jsonl': normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw, context, { identityMode: 'preserve' }),
      'system-prompt.expected.md': formatSystemPromptSnapshot(prompts[0]!, prompts.slice(1)),
      'tool-schemas.expected.json': formatToolSchemasSnapshot(schemas[0]!, schemas.slice(1)),
    }
    for (const [name, text] of Object.entries(outputs)) {
      if (process.env.DSH_SNAPSHOT === 'refresh') writeFileSync(join(scene, name), text)
      else expect(text).toBe(readFileSync(join(scene, name), 'utf8'))
    }
  } finally {
    const homeStat = lstatSync(home)
    if (!homeStat.isDirectory() || homeStat.isSymbolicLink() || !basename(home).startsWith('dsh-search-native-')
      || dirname(realpathSync(home)) !== realpathSync(tmpdir()) || realpathSync(home) !== resolve(home)) {
      throw new Error('search-native: unsafe fixture cleanup root')
    }
    for (const link of links) if (!lstatSync(link).isSymbolicLink()) throw new Error('search-native: fixture junction was replaced')
    for (const link of links) unlinkSync(link)
    rmSync(home, { recursive: true, force: true })
  }
})

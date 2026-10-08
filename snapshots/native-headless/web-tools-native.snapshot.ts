/** Shipped native web search and fetch rows: replay, blocked fetch and a drained timeout settlement. */
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { expect, it } from 'vitest'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'
import { formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizeSessionSnapshot, redactSessionSnapshotIds,
  normalizedSystemPrompts, normalizedToolSchemas } from '@deepseek-ai/dsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/native-headless/web-tools-native')
/** Stable stand-in for the loopback search endpoint, whose port differs per run. */
const SNAPSHOT_SEARCH_BASE = 'http://deepseek-search.snapshot.invalid'

function selectSessionFixture(): string {
  const selected = readdirSync(scene).flatMap(name => {
    const match = /^session(?:\.v(\d+))?\.jsonl$/.exec(name)
    return match === null ? [] : [{ name, generation: Number(match[1] ?? 0) }]
  }).sort((left, right) => right.generation - left.generation)[0]
  if (selected === undefined) throw new Error('web-tools-native: missing committed Session fixture')
  return selected.name
}

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

it('runs the shipped native web rows without Cordis or the public network and records the auxiliary request', async () => {
  const fixture = selectSessionFixture()
  const recorded = parseSessionLog(readFileSync(join(scene, fixture), 'utf8'))
  const initial = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (initial?.type !== 'user/message' || initial.data.content[0]?.type !== 'text') {
    throw new Error('web-tools-native: selected Session has no user task')
  }
  const task = initial.data.content[0].text
  const script = deriveReplayScript(recorded)
  const received: { url: string; key: string | undefined; body: string }[] = []
  let searchRequests = 0
  let probeAborted = false
  const server = createServer((request, response) => {
    const requestNumber = ++searchRequests
    response.on('close', () => { if (requestNumber === 2 && !response.writableEnded) probeAborted = true })
    void body(request).then((text) => {
      received.push({ url: request.url ?? '', key: request.headers['x-api-key'] as string | undefined, body: text })
      if (requestNumber === 2) return
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ content: [
        { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'native web tools' } },
        { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [
          { type: 'web_search_result', url: 'https://docs.example.test/native-web', title: 'Native web tools', page_age: '2026-10-01' },
        ] },
        { type: 'text', text: 'Native web tools run over the selected web service.', citations: [
          { type: 'web_search_result_location', url: 'https://docs.example.test/native-web', title: 'Native web tools', cited_text: 'run over the selected web service' },
        ] },
      ] }))
    })
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const searchBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const home = mkdtempSync(join(tmpdir(), 'dsh-web-tools-native-'))
  const profile = join(home, 'profiles/native-headless')
  const modules = join(profile, 'node_modules')
  const workspace = join(home, 'work')
  const sessions = join(home, 'sessions')
  const audit = join(home, 'audit.jsonl')
  const timeoutAudit = join(home, 'timeout-audit.jsonl')
  const links: string[] = []
  mkdirSync(join(modules, '@deepseek-ai'), { recursive: true })
  mkdirSync(workspace)
  const packages = [
    ['dsh-native-headless', 'rsh/Engine/core/native-headless'], ['dsh-native-agent', 'rsh/Engine/core/native-agent'],
    ['dsh-native-tools', 'rsh/Engine/core/native-tools'], ['dsh-native-model-execution', 'rsh/Engine/core/native-model-execution'],
    ['dsh-tool-call-timeout-policy', 'rsh/Modules/Official/guard/timeout-policy'],
    ['dsh-session-persistence-jsonl', 'rsh/Engine/session/session-persistence-jsonl'],
    ['dsh-native-prompt', 'rsh/Engine/core/native-prompt'],
    ['dsh-fs-local', 'rsh/Modules/Official/fs/fs-local'], ['dsh-fs-observation-policy', 'rsh/Modules/Official/fs/fs-observation-policy'],
    ['dsh-web', 'rsh/Modules/Official/web/web'], ['dsh-web-search-deepseek', 'rsh/Modules/Official/web/web-search-deepseek'],
    ['dsh-web-fetch-http', 'rsh/Modules/Official/web/web-fetch-http'], ['dsh-tool-web', 'rsh/Modules/Official/web/tool-web'],
  ] as const
  for (const [name, path] of packages) {
    const link = join(modules, '@deepseek-ai', name)
    symlinkSync(join(root, path), link, 'junction'); links.push(link)
  }
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'native-headless-profile', private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } }))
  const composition = shippedNativeProfileComposition(home, 'native-headless')
  // This module scene selects the shipped web rows it exercises; other P4 capabilities have separate acceptance owners.
  const selected = new Set(['app', 'agents', 'tools', 'timeout-policy', 'model-execution', 'storage', 'fs', 'policy', 'prompt',
    'web', 'web-search-deepseek', 'web-fetch-http', 'tool-web', 'pi-ai'])
  const installations = composition.installations.map((row) => {
    if (!selected.has(row.id)) return { ...row, disabled: true }
    if (row.id === 'app') return { ...row, config: {
      cwd: workspace, provider: 'mock', model: 'web', systemPrompt: 'Use the web tools for current information.', maxSteps: 3,
    } }
    if (row.id === 'tool-web') return { ...row, config: { fetch: true, searchTimeoutMs: 1000 } }
    if (row.id === 'tools') return { ...row, config: { mode: 'native' } }
    if (row.id === 'fs') return { ...row, plugin: '@deepseek-ai/dsh-fs-local', config: { cwd: workspace } }
    // Only the endpoint moves to the loopback fixture; the key still resolves through the launch environment.
    if (row.id === 'web-search-deepseek') return { ...row, config: { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: searchBase } }
    if (row.id === 'pi-ai') return { id: row.id, scope: row.scope, plugin: 'web-model' }
    return row
  })
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ ...composition, installations }))
  const model = join(modules, 'web-model'); mkdirSync(model)
  writeFileSync(join(model, 'package.json'), JSON.stringify({ name: 'web-model', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model'] } },
  }))
  writeFileSync(join(model, 'native.mjs'), `import { appendFileSync } from 'node:fs';
export const plugin = { apiVersion: 1, name: 'web-model', targets: ['host'], requires: [], provides: ['model'],
 resolve: () => context => { let step = 0; context.provide('model', { async *stream(request) {
  appendFileSync(process.env.DSH_WEB_TIMEOUT_PROBE ? ${JSON.stringify(timeoutAudit)} : ${JSON.stringify(audit)}, JSON.stringify(request.messages) + '\\n');
  const recorded = ${JSON.stringify(script)};
  const entry = recorded[step++];
  if (entry?.kind !== 'chunks') throw new Error('web-tools-native: replay exhausted');
  for (const chunk of entry.chunks) yield chunk;
 } }) } }`)
  try {
    const child = await execa(process.execPath, ['--import', pathToFileURL(join(root,
      'rsh/Programs/CLI/tests/fixtures/deny-cordis-context-register.mjs')).href,
      join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-headless', task],
    { env: { ...process.env, DSH_HOME: home, DEEPSEEK_API_KEY: 'snapshot-fixture-key' },
      reject: false, timeout: 30_000 })
    expect(child.timedOut).toBe(false)
    expect(child.exitCode, child.stderr).toBe(0)
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ url: '/messages', key: 'snapshot-fixture-key' })
    expect(JSON.parse(received[0]?.body ?? '{}')).toMatchObject({ tools: [{ type: 'web_search_20250305', name: 'web_search' }] })
    const requests = readFileSync(audit, 'utf8').trim().split('\n')
    expect(requests).toHaveLength(3)
    expect(requests[1]).toContain('[Native web tools](https://docs.example.test/native-web)')
    expect(requests[2]).toContain('resolves to a non-public IP address')
    const file = readdirSync(sessions, { recursive: true }).find(name => String(name).endsWith('session.v3.jsonl'))
    if (file === undefined) throw new Error('web-tools-native: missing Session file')
    const raw = readFileSync(join(sessions, String(file)), 'utf8').replaceAll(searchBase, SNAPSHOT_SEARCH_BASE)
    expect(raw).not.toContain('snapshot-fixture-key')
    const types = raw.trim().split('\n').map(line => (JSON.parse(line) as { type?: string }).type)
    const recorded = types.indexOf('web/deepseek-search-llm-request')
    expect(recorded).toBeGreaterThan(-1)
    expect(recorded).toBeLessThan(types.indexOf('tool/result'))
    const context = { sessionIds: [], cwd: workspace }
    const prompts = normalizedSystemPrompts(raw, context); const schemas = normalizedToolSchemas(raw, context)
    const outputs = {
      [fixture]: normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw, context, { identityMode: 'preserve' }),
      'system-prompt.expected.md': formatSystemPromptSnapshot(prompts[0]!, prompts.slice(1)),
      'tool-schemas.expected.json': formatToolSchemasSnapshot(schemas[0]!, schemas.slice(1)),
    }
    for (const [name, text] of Object.entries(outputs)) {
      if (process.env.DSH_SNAPSHOT === 'refresh') writeFileSync(join(scene, name), text)
      else expect(text).toBe(readFileSync(join(scene, name), 'utf8'))
    }

    const timeoutChild = await execa(process.execPath, ['--import', pathToFileURL(join(root,
      'rsh/Programs/CLI/tests/fixtures/deny-cordis-context-register.mjs')).href,
      join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-headless', task],
    { env: { ...process.env, DSH_HOME: home, DEEPSEEK_API_KEY: 'snapshot-fixture-key', DSH_WEB_TIMEOUT_PROBE: '1' },
      reject: false, timeout: 30_000 })
    expect(timeoutChild.timedOut).toBe(false)
    expect(timeoutChild.exitCode, timeoutChild.stderr).toBe(0)
    expect(received).toHaveLength(2)
    expect(probeAborted).toBe(true)
    expect(received[1]).toMatchObject({ url: '/messages', key: 'snapshot-fixture-key' })
    const timeoutRequests = readFileSync(timeoutAudit, 'utf8').trim().split('\n')
    expect(timeoutRequests).toHaveLength(3)
    expect(timeoutRequests[1]).toContain('tool call timed out after 1000ms')
    expect(timeoutRequests[2]).toContain('resolves to a non-public IP address')
    const timeoutFile = readdirSync(sessions, { recursive: true }).find(name => {
      if (!String(name).endsWith('session.v3.jsonl')) return false
      return readFileSync(join(sessions, String(name)), 'utf8').includes('"code":"TOOL_TIMEOUT"')
    })
    if (timeoutFile === undefined) throw new Error('web-tools-native: timeout result was not persisted')
    const timeoutRaw = readFileSync(join(sessions, String(timeoutFile)), 'utf8')
    expect(timeoutRaw).not.toContain('snapshot-fixture-key')
    expect(timeoutRaw).toContain('"code":"TOOL_TIMEOUT"')
    expect(timeoutRaw).toContain('tool call timed out after 1000ms')
  } finally {
    await new Promise<void>(done => server.close(() => { done() }))
    const homeStat = lstatSync(home)
    if (!homeStat.isDirectory() || homeStat.isSymbolicLink() || !basename(home).startsWith('dsh-web-tools-native-')
      || dirname(realpathSync(home)) !== realpathSync(tmpdir()) || realpathSync(home) !== resolve(home)) {
      throw new Error('web-tools-native: unsafe fixture cleanup root')
    }
    for (const link of links) if (!lstatSync(link).isSymbolicLink()) throw new Error('web-tools-native: fixture junction was replaced')
    for (const link of links) unlinkSync(link)
    rmSync(home, { recursive: true, force: true })
  }
})

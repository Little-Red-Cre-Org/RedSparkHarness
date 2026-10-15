/** Recorded reminder management through the public CLI and cold Session restoration. */
import { execFileSync } from 'node:child_process'
import { copyFileSync, globSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import { formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizeSessionSnapshot, normalizedSystemPrompts,
  normalizedToolSchemas, redactSessionSnapshotIds, sessionFixtureName } from '@deepseek-ai/dsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))

it('replays reminder creation and cold list/delete through the public native CLI', async () => {
  const scenario = join(root, 'snapshots/native-headless/schedule-management')
  const fixture = join(scenario, sessionFixtureName(0, SESSION_FORMAT_VERSION))
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const tasks = recorded.filter(event => event.type === 'user/message' && event.data.source.kind === 'user').map(event => {
    if (event.type !== 'user/message') throw new Error('missing recorded human input')
    return event.data.content.map(block => {
      if (block.type !== 'text') throw new Error('Schedule fixture requires text input')
      return block.text
    }).join('')
  })
  if (tasks.length !== 2) throw new Error('Schedule fixture requires two recorded human prompts')
  const streams = deriveReplayScript(recorded).map(entry => {
    if (entry.kind !== 'chunks') throw new Error('Schedule fixture requires successful recorded streams')
    return entry.chunks
  })
  const coldStart = deriveReplayScript(recorded.slice(0, recorded.findLastIndex(event =>
    event.type === 'user/message' && event.data.source.kind === 'user'))).length
  const home = mkdtempSync(join(tmpdir(), 'dsh-native-schedule-'))
  try {
    const workspace = join(home, 'workspace'), sessions = join(home, 'sessions'), audit = join(home, 'requests.jsonl')
    const profile = join(home, 'profiles/native-headless'), model = join(profile, 'node_modules/schedule-snapshot-model')
    mkdirSync(workspace); mkdirSync(model, { recursive: true })
    const recipe = join(root, 'rsh/Programs/CLI/tests/profiles/native-headless-schedule')
    for (const name of ['package.json', 'rsh.profile.json']) copyFileSync(join(recipe, name), join(profile, name))
    const require = createRequire(join(root, 'rsh/Programs/CLI/package.json'))
    writeFileSync(join(model, 'package.json'), JSON.stringify({ name: 'schedule-snapshot-model', version: '1.0.0', type: 'module',
      exports: { './native': './native.mjs', './package.json': './package.json' },
      dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model'] } } }))
    writeFileSync(join(model, 'native.mjs'), `import {appendFileSync} from 'node:fs';
      import {LlmAdapter} from ${JSON.stringify(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm/native')).href)};
      const streams=${JSON.stringify(streams)};let cursor;
      class Adapter extends LlmAdapter {
        async resolveModel(provider,id){return {provider,id,name:id};}
        async *stream(request){
          if(cursor===undefined){cursor=request.messages.some(message=>Array.isArray(message.content)&&message.content.some(
            block=>block.type==='text'&&block.text===${JSON.stringify(tasks[1])}))?${coldStart}:0;}
          appendFileSync(${JSON.stringify(audit)},JSON.stringify({kind:'root',messages:request.messages})+'\\n');
          const chunks=streams[cursor++];if(chunks===undefined)throw new Error('Schedule replay exhausted');yield* chunks;
        }
      }
      export const plugin={apiVersion:1,name:'schedule-snapshot-model',targets:['host'],requires:[],provides:['model'],
        resolve:()=>context=>context.provide('model',new Adapter())};
    `)
    const patch = join(home, 'schedule.patch.json')
    writeFileSync(patch, JSON.stringify({ formatVersion: 1, installations: [
      { id: 'app', config: { cwd: workspace, provider: 'fixture', model: 'parent',
        systemPrompt: 'Manage explicit session-local reminders and report durable results.', maxSteps: 4 } },
      { id: 'storage', config: { root: sessions, compression: 'none' } },
      { id: 'fs', config: { cwd: workspace } },
    ] }))
    const run = async (task: string, resume?: string): Promise<string> => {
      const launch = resolveExampleLaunch({ srcBin: join(root, 'rsh/Programs/CLI/src/bin.ts'),
        libBin: join(root, 'rsh/Programs/CLI/lib/bin.js'), configArgs: ['--profile', 'native-headless', '--patch', patch,
          ...resume === undefined ? [] : ['--resume', resume], task], tsconfigPath: join(root, 'tsconfig.json'),
        sourceImport: 'tsx/esm', env: { DSH_HOME: home } })
      const process = await execa(launch.command, ['--import',
        pathToFileURL(join(root, 'rsh/Programs/CLI/tests/fixtures/deny-cordis-import.mjs')).href, ...launch.args],
      { cwd: workspace, env: launch.env, reject: false })
      expect(process.exitCode, process.stderr).toBe(0)
      return process.stdout
    }
    expect(await run(tasks[0] ?? '')).toContain('Reminder created and listed.')
    const files = globSync('**/*.jsonl', { cwd: sessions })
    expect(files).toHaveLength(1)
    const path = join(sessions, files[0] ?? '')
    const header = JSON.parse(readFileSync(path, 'utf8').split('\n')[0] ?? '') as { id: string }
    expect(await run(tasks[1] ?? '', header.id)).toContain('Restored reminder canceled; no reminders remain.')
    const raw = readFileSync(path, 'utf8'), events = parseSessionLog(raw)
    expect(events.filter(event => event.type === 'schedule/change').map(event => event.data.operation)).toEqual(['create', 'delete'])
    expect(events.filter(event => event.type === 'tool/call').map(event => event.data.name)).toEqual([
      'schedule_create', 'schedule_list', 'schedule_list', 'schedule_delete', 'schedule_list'])
    expect(events.filter(event => event.type === 'turn/end')).toHaveLength(2)
    expect(events.map(event => event.seq)).toEqual(events.map((_event, index) => index))
    expect(readdirSync(workspace)).toEqual([])
    const requestRows = readFileSync(audit, 'utf8').trim().split('\n')
    expect(requestRows).toHaveLength(7)
    const requests = requestRows.map(line => JSON.parse(line) as { kind: string; messages: unknown })
    expect(requests.every(request => request.kind === 'root')).toBe(true)
    expect(JSON.stringify(requests.at(-1))).toContain('Review the durable reminder.')
    const context = { sessionIds: [], cwd: workspace, cwdAliases: [JSON.stringify(workspace).slice(1, -1)] }
    const systems = normalizedSystemPrompts(raw, context)
    const outputs = new Map([
      [fixture, normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? '', context, { identityMode: 'preserve' })],
      [join(scenario, 'system-prompt.expected.md'), formatSystemPromptSnapshot(systems[0] ?? '', systems.slice(1))],
      [join(scenario, 'tool-schemas.expected.json'), formatToolSchemasSnapshot(normalizedToolSchemas(raw, context)[0] ?? [])],
    ])
    for (const [path, contents] of outputs) {
      if (process.env.DSH_SNAPSHOT !== 'refresh') expect(contents).toBe(readFileSync(path, 'utf8'))
      else {
        const tracked = execFileSync('git', ['ls-files', '--', path.slice(root.length).replaceAll('\\', '/')],
          { cwd: root, encoding: 'utf8' }).trim() !== ''
        if (tracked && readFileSync(path, 'utf8') !== contents) throw new Error('refusing to replace committed Schedule fixture')
        if (!tracked) writeFileSync(path, contents)
      }
    }
  } finally { rmSync(home, { recursive: true, force: true }) }
})

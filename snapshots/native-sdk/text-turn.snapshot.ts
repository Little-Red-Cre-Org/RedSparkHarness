/** One recorded native SDK text turn through the shipped dsh profile and TypeScript client. */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { execa } from 'execa'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { DeepSeekHarness, type HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'
import { formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizedSystemPrompts, normalizedToolSchemas,
  normalizeSessionSnapshot, redactSessionSnapshotIds } from '@deepseek-ai/dsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/native-sdk/text-turn')
const fixture = join(scene, 'session.v3.jsonl')

it('replays a native SDK turn with exact model input, output and durable Session events', async () => {
  const recorded = existsSync(fixture) ? parseSessionLog(readFileSync(fixture, 'utf8')) : undefined
  const input = recorded?.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const answer = recorded?.find(event => event.type === 'assistant/message')
  const task = input?.type === 'user/message' && input.data.content[0]?.type === 'text'
    ? input.data.content[0].text : 'say hello through native SDK'
  const reply = answer?.type === 'assistant/message' && answer.data.message.content[0]?.type === 'text'
    ? answer.data.message.content[0].text : 'native SDK snapshot reply'
  const requests: Record<string, unknown>[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      const modelRequest = JSON.parse(body) as Record<string, unknown>
      requests.push(modelRequest)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      if (requests.length === 1) {
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: reply } }] })}\n\n`)
        return
      }
      const last = (modelRequest.messages as Array<{ role: string; content: unknown }>).at(-1)
      if (last?.role === 'user' && last.content === 'fail production child') {
        response.end([
          { choices: [{ delta: { role: 'assistant', content: 'partial failed child output' } }] },
          { error: { message: 'fixture child model failed', type: 'invalid_request_error', code: 'fixture_child_failure' } },
        ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
        return
      }
      if (last?.role === 'user' && ['hold production child', 'hold background child'].includes(String(last.content))) {
        response.end([
          ...last.content === 'hold background child' ? [{ choices: [{ delta: { role: 'assistant', content: 'background child live output' } }] }] : [],
          { choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'child-wait', type: 'function',
            function: { name: 'fixture_wait', arguments: '{}' } }] } }] },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n')
        return
      }
      if (last?.role === 'user' && ['start a background child', 'stop the background child'].includes(String(last.content))) {
        const calls = last.content === 'start a background child'
          ? [{ name: 'subagent', arguments: JSON.stringify({ description: 'background child', prompt: 'hold background child', run_in_background: true }) }]
          : [{ name: 'job_output', arguments: JSON.stringify({ job_id: 'subagent-1' }) },
            { name: 'job_kill', arguments: JSON.stringify({ job_id: 'subagent-1', reason: 'fixture background cancel' }) },
            { name: 'job_output', arguments: JSON.stringify({ job_id: 'subagent-1', wait: true, timeout_ms: 10000 }) }]
        response.end([
          { choices: [{ delta: { role: 'assistant', tool_calls: calls.map((call, index) => ({ index,
            id: `background-call-${index}`, type: 'function', function: call })) } }] },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n')
        return
      }
      if (last?.role === 'user' && ['spawn a production child', 'cancel a production child', 'fail a production child', 'production child task'].includes(String(last.content))) {
        const calls = last.content !== 'production child task'
          ? [{ name: 'subagent', arguments: JSON.stringify({ description: 'production child',
              prompt: last.content === 'spawn a production child' ? 'production child task'
                : last.content === 'fail a production child' ? 'fail production child' : 'hold production child' }) }]
          : [{ name: 'fixture_delegate_child', arguments: '{}' }, { name: 'fixture_protected', arguments: '{}' },
              { name: 'subagent', arguments: JSON.stringify({ description: 'forbidden grandchild', prompt: 'grandchild task' }) }]
        response.end([
          { choices: [{ delta: { role: 'assistant', tool_calls: calls.map((call, index) => ({ index,
            id: `production-call-${index}`, type: 'function', function: call })) } }] },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n')
        return
      }
      if (last?.role === 'user' && ['delegate a native child', 'foreign root task'].includes(String(last.content))) {
        response.end([
          { choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'fixture-delegate', type: 'function',
            function: { name: 'fixture_delegate_child', arguments: '{}' } }] } }] },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n')
        return
      }
      const productionChild = (modelRequest.messages as Array<{ role: string; content: unknown }>)
        .some(message => message.role === 'user' && message.content === 'production child task')
      const responseText = productionChild ? 'production child reply'
        : last?.role === 'user' && last.content === 'child task' ? 'native SDK child reply' : reply
      response.end([
        { choices: [{ delta: { role: 'assistant', content: responseText } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('native-sdk snapshot: missing model endpoint')
  const home = mkdtempSync(join(tmpdir(), 'dsh-native-sdk-snapshot-'))
  const workspace = join(home, 'workspace')
  const sessions = join(home, 'sessions')
  const patch = join(home, 'model.patch.json')
  mkdirSync(workspace)
  const profile = join(home, 'profiles', 'native-sdk')
  const fixturePackage = join(profile, 'node_modules', 'fixture-sdk-descendants')
  mkdirSync(fixturePackage, { recursive: true })
  const fixtureUrl = pathToFileURL(join(root, 'rsh/Programs/SDK/packages/native-server/tests/fixtures/descendants.mjs')).href
  const { plugin } = await import(fixtureUrl) as { plugin: { apiVersion: number; targets: string[];
    requires: string[]; optional: string[]; provides: string[] } }
  writeFileSync(join(fixturePackage, 'native.mjs'), `export { plugin } from ${JSON.stringify(fixtureUrl)}\n`)
  writeFileSync(join(fixturePackage, 'package.json'), JSON.stringify({ name: 'fixture-sdk-descendants', type: 'module',
    exports: { './package.json': './package.json', './native': './native.mjs' },
    dsh: { native: { apiVersion: plugin.apiVersion, entry: './native', targets: plugin.targets,
      requires: plugin.requires, optional: plugin.optional, provides: plugin.provides } } }))
  const composition = shippedNativeProfileComposition(home, 'native-sdk')
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'native-sdk-fixture', private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } }))
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ ...composition, installations: [
    ...composition.installations,
    { id: 'fixture-approval', plugin: '@deepseek-ai/dsh-native-approval', scope: 'root', config: { policy: 'ask' } },
    { id: 'descendants', scope: 'root', plugin: 'fixture-sdk-descendants' },
  ] }))
  writeFileSync(patch, JSON.stringify({ formatVersion: 1, installations: [
    { id: 'app', config: { systemPrompt: 'You are a native SDK fixture.', maxSteps: 2 } },
    { id: 'subagent-tool', config: { toolName: 'subagent', maxDepth: 1, maxTokens: 128,
      persona: 'Only the production child receives this persona.', toolFilter: { deny: ['fixture_delegate_child'] } } },
    { id: 'storage', config: { root: sessions, compression: 'none' } },
    { id: 'pi-ai', config: { providers: { fixture: { apiKeyEnv: 'NATIVE_SDK_FIXTURE_KEY', api: 'openai-completions',
      baseURL: `http://127.0.0.1:${address.port}/v1`, models: [{ id: 'fixture-model', input: ['text', 'image'] }] } } } },
  ] }))
  const harness = new DeepSeekHarness({ profile: 'native-sdk', dshBin: join(root, 'rsh/Programs/CLI/lib/bin.js'),
    dshHome: home, patches: [patch], cwd: workspace, provider: 'fixture', model: 'fixture-model',
    env: { ...process.env, NATIVE_SDK_FIXTURE_KEY: 'fixture-key', DSH_TELEMETRY_DISABLED: '1' },
    requestTimeoutMs: 20_000 })
  try {
    let result
    if (process.env.DSH_NATIVE_SDK_PYTHON !== undefined) {
      const launcher = join(home, process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
      writeFileSync(launcher, process.platform === 'win32'
        ? `@echo off\r\n"${process.execPath}" "${join(root, 'rsh/Programs/CLI/lib/bin.js')}" %*\r\n`
        : `#!/bin/sh\nexec "${process.execPath}" "${join(root, 'rsh/Programs/CLI/lib/bin.js')}" "$@"\n`)
      if (process.platform !== 'win32') chmodSync(launcher, 0o700)
      const python = await execa(process.env.DSH_NATIVE_SDK_PYTHON, [join(scene, 'client.py'), launcher, home, workspace, patch, task], {
        env: { ...process.env, PYTHONPATH: join(root, 'rsh/Programs/SDK/python/sdk/src'), NATIVE_SDK_FIXTURE_KEY: 'fixture-key' },
        timeout: 30000,
      })
      result = JSON.parse(python.stdout) as { finalResponse: string; events: Array<{type: string; data: unknown}>;
        notifications: HarnessNotification[] }
    } else {
      const session = harness.session('sdk-recorded-turn')
      expect(await session.cancel()).toBe(false)
      await expect(session.steer('idle steering')).rejects.toThrow()
      const chunk = Promise.withResolvers<void>()
      const pending = session.run(task, { onNotification: notification => {
        if (notification.method === 'session.chunk' && (notification.params.chunk as { type?: string }).type === 'text-delta') chunk.resolve()
      } })
      await chunk.promise
      await expect(harness.session('unknown-session').steer('foreign steering')).rejects.toThrow()
      const steering = await session.steer('redirect after cancellation')
      expect(steering).not.toBe('')
      expect(await harness.session('unknown-session').cancel()).toBe(false)
      expect(await session.cancel()).toBe(true)
      const cancelled = await pending
      expect(cancelled.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } })
      expect(cancelled.events.some(event => event.type === 'assistant/attempt')).toBe(true)
      expect(cancelled.events.some(event => event.type === 'agent/inbox/spliced' && event.data.target === 'next-step'
        && event.data.inserted.some(message => message.id === steering))).toBe(true)
      await expect(session.steer('settled steering')).rejects.toThrow()
      await harness.close()
      const resumed = new DeepSeekHarness({ ...harness.client.options, cwd: workspace, provider: 'fixture', model: 'fixture-model' })
      try {
        result = await resumed.run('finish after cancellation', { sessionId: 'sdk-recorded-turn' })
        const source = resumed.session('sdk-recorded-turn')
        await expect(source.fork('sdk-recorded-turn')).rejects.toThrow()
        await expect(source.fork('sdk-recorded-fork', Number.MAX_SAFE_INTEGER)).rejects.toThrow()
        const anchor = result.events.at(-1)?.seq
        if (anchor === undefined) throw new Error('native-sdk snapshot: fork anchor missing')
        const fork = await source.fork('sdk-recorded-fork', anchor)
        expect(fork.id).toBe('sdk-recorded-fork')
        expect(requests).toHaveLength(2)
      }
      finally { await resumed.close() }
      const forked = new DeepSeekHarness({ ...harness.client.options, cwd: workspace, provider: 'fixture', model: 'fixture-model' })
      try {
        const session = forked.session('sdk-recorded-fork')
        const data = readFileSync(join(scene, 'image.png')).toString('base64')
        await expect(session.run([{ type: 'image', data: 'invalid', mimeType: 'image/png' }])).rejects.toThrow()
        await expect(session.run([{ type: 'image', data, mimeType: 'image/jpeg' }])).rejects.toThrow()
        expect(requests).toHaveLength(2)
        result = await session.run([{ type: 'text', text: 'finish the cold fork' }, { type: 'image', data, mimeType: 'image/png' }])
      }
      finally { await forked.close() }
      const restored = new DeepSeekHarness({ ...harness.client.options, cwd: workspace, provider: 'fixture', model: 'fixture-model' })
      try {
        result = await restored.session('sdk-recorded-fork').run('retain the image')
        result = await restored.session('sdk-recorded-fork').run('delegate a native child')
        const delegated = result
        result = await restored.session('sdk-recorded-fork').run('spawn a production child')
        result = { ...result, notifications: [...delegated.notifications, ...result.notifications] }
        const production = result
        const session = restored.session('sdk-recorded-fork')
        const failed = await session.run('fail a production child')
        expect(failed.events.find(event => event.type === 'tool/result')?.data.message.content)
          .toMatchObject([{ type: 'tool-result', isError: true, content: [
            { type: 'text', text: 'Subagent ended: error. Partial output follows.' },
            { type: 'text', text: 'partial failed child output' },
          ] }])
        expect(failed.finalResponse).toBe(reply)
        const backgroundEvents = restored.client.subscribeSessionTree(session.id)
        try {
          const started = await session.run('start a background child')
          expect(started.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
          const start = started.events.find(event => event.type === 'tool/result')?.data.message.content[0]
          expect(start).toMatchObject({ type: 'tool-result', isError: false, content: [{ type: 'text', text: expect.stringContaining('Job: subagent-1') }] })
          for (;;) {
            const notification = await backgroundEvents.next()
            if (notification.method === 'session.event' && notification.params.sessionId !== session.id
              && (notification.params.event as { type?: string }).type === 'tool/call') break
          }
          const stopped = await session.run('stop the background child')
          const outputs = stopped.events.filter(event => event.type === 'tool/result').map(event => event.data.message.content[0])
          expect(outputs[0]).toMatchObject({ type: 'tool-result', isError: false, content: [{ type: 'text', text: expect.stringContaining('background child live output') }] })
          expect(JSON.stringify(outputs[0])).toContain('running')
          expect(JSON.stringify(outputs[1])).toContain('requested cancellation')
          expect(JSON.stringify(outputs[2])).toContain('cancelled')
          expect(stopped.finalResponse).toBe(reply)
        } finally { backgroundEvents.close() }
        const childChunk = Promise.withResolvers<void>()
        const pending = session.run('cancel a production child', { onNotification: notification => {
          if (notification.method === 'session.event' && notification.params.sessionId !== session.id
            && (notification.params.event as { type?: string }).type === 'tool/call') childChunk.resolve()
        } })
        await childChunk.promise
        expect(await session.cancel()).toBe(true)
        const cancelledChild = await pending
        expect(cancelledChild.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted' } } })
        expect(cancelledChild.notifications.some(notification => notification.method === 'session.event'
          && notification.params.sessionId !== session.id && (notification.params.event as { type: string; data: unknown }).type === 'turn/end')).toBe(true)
        result = production
      }
      finally { await restored.close() }
      const recovered = new DeepSeekHarness({ ...harness.client.options, cwd: workspace, provider: 'fixture', model: 'fixture-model' })
      try {
        const resumed = await recovered.session('sdk-recorded-fork').run('recover after child cancellation')
        expect(resumed.finalResponse).toBe(reply)
        expect(resumed.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
      }
      finally { await recovered.close() }
    }
    expect(result.finalResponse).toBe(reply)
    expect(result.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(requests, JSON.stringify(result.events.filter(event => event.type === 'tool/result'))).toHaveLength(25)
    expect(result.notifications.filter(notification => notification.method === 'subagent.started').map(notification => notification.params))
      .toEqual([{ parentSessionId: 'sdk-recorded-fork', childSessionId: 'sdk-recorded-child' },
        { parentSessionId: 'sdk-recorded-fork', childSessionId: expect.any(String) }])
    const spawned = result.notifications.filter(notification => notification.method === 'subagent.started').at(-1)?.params.childSessionId
    expect(typeof spawned).toBe('string')
    expect(existsSync(join(workspace, 'protected-marker'))).toBe(false)
    expect(existsSync(join(workspace, 'answerer-called'))).toBe(false)
    expect(result.notifications.some(notification => notification.method === 'session.event'
      && notification.params.sessionId === 'sdk-recorded-child'
      && (notification.params.event as { type: string }).type === 'turn/end')).toBe(true)
    expect(result.notifications.some(notification => Object.values(notification.params).some(value =>
      typeof value === 'string' && value.startsWith('sdk-foreign-')))).toBe(false)
    const request = requests[1]
    if (request === undefined) throw new Error('native-sdk snapshot: model request missing')
    const modelInput = JSON.stringify({ model: request.model, messages: request.messages, tools: request.tools ?? [] }, null, 2) + '\n'
    const logs = readdirSync(sessions, { recursive: true }).filter(name => String(name).endsWith('session.v3.jsonl'))
      .map(name => readFileSync(join(sessions, String(name)), 'utf8'))
    const findLog = (id: string): string => {
      const raw = logs.find(log => (JSON.parse(log.split('\n')[0] ?? '{}') as { id: string }).id === id)
      if (raw === undefined) throw new Error(`native-sdk snapshot: durable Session missing: ${id}`)
      return raw
    }
    const raw = findLog('sdk-recorded-turn')
    const forkRaw = findLog('sdk-recorded-fork')
    expect(logs).toHaveLength(9)
    const childTask = (log: string, task: string): boolean => (JSON.parse(log.split('\n')[0] ?? '{}') as { origin?: string }).origin === 'subagent'
      && parseSessionLog(log).some(event => event.type === 'user/message' && event.data.content.some(block => block.type === 'text' && block.text === task))
    const failedChildLog = logs.find(log => childTask(log, 'fail production child'))
    if (failedChildLog === undefined) throw new Error('native-sdk snapshot: failed child missing')
    expect(parseSessionLog(failedChildLog).at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'error' } } })
    const normalizedFailed = normalizeSessionSnapshot(redactSessionSnapshotIds([failedChildLog])[0] ?? failedChildLog,
      { cwd: workspace, sessionIds: [] }, { identityMode: 'preserve' })
    const failedFixture = join(scene, 'session.4.v3.jsonl')
    if (process.env.DSH_SNAPSHOT === 'refresh') writeFileSync(failedFixture, normalizedFailed)
    else expect(normalizedFailed).toBe(readFileSync(failedFixture, 'utf8'))
    const backgroundLog = logs.find(log => childTask(log, 'hold background child'))
    if (backgroundLog === undefined) throw new Error('native-sdk snapshot: background child missing')
    expect(parseSessionLog(backgroundLog).at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted' } } })
    const normalizedBackground = normalizeSessionSnapshot(redactSessionSnapshotIds([backgroundLog])[0] ?? backgroundLog,
      { cwd: workspace, sessionIds: [] }, { identityMode: 'preserve' })
    const backgroundFixture = join(scene, 'session.5.v3.jsonl')
    if (process.env.DSH_SNAPSHOT === 'refresh') writeFileSync(backgroundFixture, normalizedBackground)
    else expect(normalizedBackground).toBe(readFileSync(backgroundFixture, 'utf8'))
    const cancelledChildLog = logs.find(log => childTask(log, 'hold production child'))
    if (cancelledChildLog === undefined) throw new Error('native-sdk snapshot: cancelled child missing')
    expect(parseSessionLog(cancelledChildLog).at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted' } } })
    const normalizedCancelled = normalizeSessionSnapshot(redactSessionSnapshotIds([cancelledChildLog])[0] ?? cancelledChildLog,
      { cwd: workspace, sessionIds: [] }, { identityMode: 'preserve' })
    const cancelledFixture = join(scene, 'session.3.v3.jsonl')
    if (process.env.DSH_SNAPSHOT === 'refresh') writeFileSync(cancelledFixture, normalizedCancelled)
    else expect(normalizedCancelled).toBe(readFileSync(cancelledFixture, 'utf8'))
    const productionRaw = findLog(String(spawned))
    const productionEvents = parseSessionLog(productionRaw)
    expect(productionEvents.find(event => event.type === 'subagent/descriptor')?.data)
      .toMatchObject({ version: 3, mode: 'one-shot', provider: 'spawn', label: 'production child' })
    expect(productionEvents.find(event => event.type === 'native-approval/decided')?.data)
      .toMatchObject({ policy: 'never', outcome: 'rejected' })
    expect(productionEvents.filter(event => event.type === 'tool/result').every(event => event.data.message.content[0]?.type === 'tool-result'
      && event.data.message.content[0].isError)).toBe(true)
    const childRequest = requests[11]
    expect((childRequest?.tools as Array<{ function: { name: string } }>).map(tool => tool.function.name))
      .not.toContain('fixture_delegate_child')
    expect(JSON.stringify(childRequest?.tools)).not.toContain('read_file')
    expect(JSON.stringify(childRequest?.messages)).toContain('Only the production child receives this persona.')
    expect(JSON.stringify(requests[10]?.messages)).not.toContain('Only the production child receives this persona.')
    expect(childRequest?.max_completion_tokens, JSON.stringify(childRequest)).toBe(128)
    const productionFixture = join(scene, 'session.2.v3.jsonl')
    const normalizedProduction = normalizeSessionSnapshot(redactSessionSnapshotIds([productionRaw])[0] ?? productionRaw,
      { cwd: workspace, sessionIds: [] }, { identityMode: 'preserve' })
    if (process.env.DSH_SNAPSHOT === 'refresh') writeFileSync(productionFixture, normalizedProduction)
    else expect(normalizedProduction).toBe(readFileSync(productionFixture, 'utf8'))
    const childRaw = findLog('sdk-recorded-child')
    expect(JSON.parse(childRaw.split('\n')[0] ?? '{}')).toMatchObject({ parentSession: 'sdk-recorded-fork', origin: 'subagent' })
    const normalizedChild = normalizeSessionSnapshot(redactSessionSnapshotIds([childRaw])[0] ?? childRaw,
      { cwd: workspace, sessionIds: [] }, { identityMode: 'preserve' })
    const childFixture = join(scene, 'session.1.v3.jsonl')
    if (process.env.DSH_SNAPSHOT === 'refresh') writeFileSync(childFixture, normalizedChild)
    else expect(normalizedChild).toBe(readFileSync(childFixture, 'utf8'))
    const context = { cwd: workspace, sessionIds: [] }
    const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw, context, { identityMode: 'preserve' })
    const forkContext = { cwd: workspace, sessionIds: [] }
    const normalizedFork = normalizeSessionSnapshot(redactSessionSnapshotIds([forkRaw])[0] ?? forkRaw,
      forkContext, { identityMode: 'preserve' })
    const forkRequest = requests[3]
    if (forkRequest === undefined) throw new Error('native-sdk snapshot: fork model request missing')
    const imageMessage = parseSessionLog(forkRaw).find(event => event.type === 'user/message'
      && event.data.content.some(block => block.type === 'image'))
    const image = imageMessage?.type === 'user/message' ? imageMessage.data.content.find(block => block.type === 'image') : undefined
    if (image?.type !== 'image') throw new Error('native-sdk snapshot: durable image reference missing')
    const digest = image.attachment.attachmentId.slice('sha256:'.length)
    const objectPath = ['attachments', 'v1', 'objects', digest.slice(0, 2), digest]
    const quotedHostPath = JSON.stringify(join(home, ...objectPath))
    const quotedFixturePath = JSON.stringify(`{{home}}/${objectPath.join('/')}`)
    const forkModelInput = JSON.stringify({ model: forkRequest.model, messages: forkRequest.messages,
      tools: forkRequest.tools ?? [] }, (_key, value: unknown) => typeof value === 'string'
      ? value.replace(quotedHostPath, quotedFixturePath) : value, 2) + '\n'
    const prompts = normalizedSystemPrompts(raw, context)
    const schemas = normalizedToolSchemas(raw, context)
    if (prompts[0] === undefined || schemas[0] === undefined) throw new Error('native-sdk snapshot: request header missing')
    const systemPrompt = formatSystemPromptSnapshot(prompts[0], prompts.slice(1))
    const tools = formatToolSchemasSnapshot(schemas[0], schemas.slice(1))
    if (process.env.DSH_SNAPSHOT === 'refresh') {
      writeFileSync(fixture, normalized)
      writeFileSync(join(scene, 'fork-session.v3.jsonl'), normalizedFork)
      writeFileSync(join(scene, 'fork-model-request.expected.json'), forkModelInput)
      writeFileSync(join(scene, 'model-request.expected.json'), modelInput)
      writeFileSync(join(scene, 'system-prompt.expected.md'), systemPrompt)
      writeFileSync(join(scene, 'tool-schemas.expected.json'), tools)
    } else {
      expect(normalized).toBe(readFileSync(fixture, 'utf8'))
      expect(normalizedFork).toBe(readFileSync(join(scene, 'fork-session.v3.jsonl'), 'utf8'))
      expect(forkModelInput).toBe(readFileSync(join(scene, 'fork-model-request.expected.json'), 'utf8'))
      expect(modelInput).toBe(readFileSync(join(scene, 'model-request.expected.json'), 'utf8'))
      expect(systemPrompt).toBe(readFileSync(join(scene, 'system-prompt.expected.md'), 'utf8'))
      expect(tools).toBe(readFileSync(join(scene, 'tool-schemas.expected.json'), 'utf8'))
    }
  } finally {
    await harness.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(home, { recursive: true, force: true })
  }
})

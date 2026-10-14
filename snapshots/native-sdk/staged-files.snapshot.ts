/** One native SDK Session stages files before its first prompt, steers another file, then cold-reads durable bytes. */
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { LocalAttachmentBackend } from '@deepseek-ai/dsh-attachment-local/backend'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizedSystemPrompts, normalizedToolSchemas,
  normalizeSessionSnapshot, redactSessionSnapshotIds } from '@deepseek-ai/dsh-session-snapshot'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/native-sdk/staged-files')
const fixture = join(scene, 'session.v3.jsonl')
const sessionId = 'sdk-staged-files'

interface ModelRequest {
  model?: string
  messages?: Array<{ role?: string; content?: unknown; tool_calls?: unknown }>
  tools?: Array<{ function?: { name?: string } }>
}

function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringsIn)
  if (typeof value !== 'object' || value === null) return []
  return Object.values(value).flatMap(stringsIn)
}

function quotedPath(marker: string, anchor: string, description: string): string {
  const offset = marker.indexOf(anchor)
  const token = offset < 0 ? undefined : /"(?:\\.|[^"\\])*"/u.exec(marker.slice(offset + anchor.length))?.[0]
  const path = token === undefined ? undefined : JSON.parse(token) as unknown
  if (typeof path !== 'string') throw new Error(`native-sdk staged-files: model request omitted the ${description} path`)
  return path
}

function fileHandle(request: ModelRequest, name: string): string {
  const marker = stringsIn(request.messages).find(value => value.includes(`File "${name}"`) && value.includes('saved at'))
  if (marker === undefined) throw new Error(`native-sdk staged-files: model request omitted the read-only ${name} handle`)
  return quotedPath(marker, 'saved at ', `read-only ${name} handle`)
}

function imageHandle(request: ModelRequest): string {
  const marker = stringsIn(request.messages).find(value => value.includes('Normalized copy (read-only; may be resized or re-encoded):'))
  if (marker === undefined) throw new Error('native-sdk staged-files: model request omitted the normalized image path')
  return quotedPath(marker, 'Normalized copy (read-only; may be resized or re-encoded): ', 'normalized image')
}

function stablePath(home: string, path: string): string {
  const tail = relative(home, path)
  if (!isAbsolute(path) || tail === '' || tail === '..' || tail.startsWith(`..${sep}`) || isAbsolute(tail)) {
    throw new Error('native-sdk staged-files: provider handle is outside the fixture DSH_HOME')
  }
  return `{{home}}/${tail.split(sep).join('/')}`
}

type PathMapping = readonly [path: string, token: string]

function pathMappings(home: string, paths: readonly string[]): PathMapping[] {
  return paths.flatMap((path) => {
    const token = stablePath(home, path)
    return [[path, token] as const, [JSON.stringify(path), JSON.stringify(token)] as const]
  })
}

function mapFixturePaths(value: unknown, mappings: readonly PathMapping[], key?: string): unknown {
  if (typeof value === 'string') {
    if (key === 'arguments') {
      try { return JSON.stringify(mapFixturePaths(JSON.parse(value) as unknown, mappings)) }
      catch { /* Partial tool-call arguments remain ordinary text. */ }
    }
    return mappings.reduce((text, [path, token]) => text.replaceAll(path, token), value)
  }
  if (Array.isArray(value)) {
    return value.map(item => mapFixturePaths(item, mappings, key === 'args' ? 'arguments' : undefined))
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, item]) => [
      childKey, mapFixturePaths(item, mappings, childKey),
    ]))
  }
  return value
}

function normalizedFixture(raw: string, context: { cwd: string; sessionIds: string[] }, mappings: readonly PathMapping[]): string {
  const normalized = normalizeSessionSnapshot(raw, context, { identityMode: 'preserve' })
  const lines = normalized.split(/\r?\n/u)
  const trailingNewline = lines.at(-1) === ''
  const mapped = lines.filter(line => line !== '').map((line) => {
    const record = JSON.parse(line) as unknown
    return JSON.stringify(mapFixturePaths(record, mappings))
  }).join('\n') + (trailingNewline ? '\n' : '')
  return redactSessionSnapshotIds([mapped])[0] ?? mapped
}

function writeToolCall(response: ServerResponse, id: string, path: string): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end([
    { choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id, type: 'function',
      function: { name: 'read_file', arguments: JSON.stringify({ path }) } }] }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    '[DONE]',
  ].map(event => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join(''))
}

function writeText(response: ServerResponse, text: string): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end([
    { choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    '[DONE]',
  ].map(event => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join(''))
}

async function control(url: string, path: string, method = 'GET'): Promise<string> {
  const response = await fetch(`${url}${path}`, { method })
  const body = await response.text()
  if (!response.ok) throw new Error(`native-sdk staged-files: ${path} returned ${response.status}: ${body}`)
  return body
}

function modelSnapshot(requests: readonly ModelRequest[], mappings: readonly PathMapping[]): unknown[] {
  const normalizeImage = (value: unknown): unknown => {
    if (typeof value === 'string') return value
      .replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/giu, '[encoded fixture image]')
    if (Array.isArray(value)) return value.map(normalizeImage)
    if (typeof value !== 'object' || value === null) return value
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeImage(item)]))
  }
  return requests.map(request => ({
    model: request.model,
    messages: request.messages?.filter(message => message.role !== 'system')
      .map(message => normalizeImage(mapFixturePaths(message, mappings))),
    tools: request.tools?.map(tool => tool.function?.name),
  }))
}

function sessionFiles(directory: string): string[] {
  const found: string[] = []
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.name === 'session.v3.jsonl') found.push(path)
    }
  }
  visit(directory)
  return found
}

function modelMessages(request: ModelRequest): string {
  return JSON.stringify(request.messages ?? [])
}

it('stages ordered Native SDK files, reads them through the model file handles, and cold-restores once for both SDK clients', async () => {
  const firstBytes = readFileSync(join(scene, 'first.txt'))
  const secondBytes = readFileSync(join(scene, 'second.txt'))
  const imageBytes = readFileSync(join(scene, 'image.png'))
  const requests: ModelRequest[] = []
  const firstRequest = Promise.withResolvers<void>()
  let heldInitialResponse: ServerResponse | undefined
  let initialHandle = ''
  const server = createServer((request, response) => {
    if (request.url === '/await-initial') {
      void firstRequest.promise.then(() => response.end('ready'))
      return
    }
    if (request.url === '/release-initial') {
      if (heldInitialResponse === undefined || initialHandle === '') {
        response.writeHead(409).end('initial model request is not waiting')
        return
      }
      writeToolCall(heldInitialResponse, 'read-first-file', initialHandle)
      heldInitialResponse = undefined
      response.end('released')
      return
    }
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.on('end', () => {
      const bytes = Buffer.concat(chunks)
      const body = request.headers['content-encoding'] === 'zstd' ? zstdDecompressSync(bytes) : bytes
      const modelRequest = JSON.parse(body.toString('utf8')) as ModelRequest
      requests.push(modelRequest)
      const index = requests.length
      if (index === 1) {
        try { initialHandle = fileHandle(modelRequest, 'first.txt') }
        catch (error: unknown) { response.writeHead(500).end(String(error)); return }
        heldInitialResponse = response
        firstRequest.resolve()
        return
      }
      try {
        if (index === 2) writeToolCall(response, 'read-second-file', fileHandle(modelRequest, 'second.txt'))
        else if (index === 3) writeText(response, 'Both uploaded files were read.')
        else if (index === 4) writeToolCall(response, 'cold-read-first-file', fileHandle(modelRequest, 'first.txt'))
        else if (index === 5) writeText(response, 'The restored first file is readable.')
        else response.writeHead(500).end(`unexpected model request ${index}`)
      } catch (error: unknown) {
        response.writeHead(500).end(String(error))
      }
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('native-sdk staged-files: missing model endpoint')
  const baseURL = `http://127.0.0.1:${address.port}`
  const home = mkdtempSync(join(tmpdir(), 'dsh-attachment-staged-home-'))
  const workspace = join(home, 'workspace')
  const sessions = join(home, 'sessions')
  const profile = join(home, 'profiles', 'native-sdk')
  const patch = join(home, 'model.patch.json')
  mkdirSync(workspace, { recursive: true })
  mkdirSync(profile, { recursive: true })
  const composition = shippedNativeProfileComposition(home, 'native-sdk')
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'native-sdk-staged-files-fixture', private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } }))
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify(composition))
  writeFileSync(patch, JSON.stringify({ formatVersion: 1, installations: [
    { id: 'app', config: { systemPrompt: 'Read uploaded files only through their read-only file handles.', maxSteps: 4 } },
    { id: 'storage', config: { root: sessions, compression: 'none' } },
    { id: 'pi-ai', config: { providers: { fixture: { apiKeyEnv: 'NATIVE_SDK_FIXTURE_KEY', api: 'openai-completions',
      baseURL: `${baseURL}/v1`, models: [{ id: 'fixture-model', input: ['text', 'image'] }] } } } },
  ] }))
  const imageBase64 = imageBytes.toString('base64')
  const options = { profile: 'native-sdk', dshBin: join(root, 'rsh/Programs/CLI/lib/bin.js'), dshHome: home,
    patches: [patch], cwd: workspace, provider: 'fixture', model: 'fixture-model', allowedTools: ['read_file'],
    env: { ...process.env, NATIVE_SDK_FIXTURE_KEY: 'fixture-key', DSH_TELEMETRY_DISABLED: '1' }, requestTimeoutMs: 20_000 }
  let firstResult: { finalResponse: string } | undefined
  let coldResult: { finalResponse: string } | undefined
  let steeringId = ''
  let firstReceipt: { receiptId: string; name: string; bytes: number } | undefined
  let secondReceipt: { receiptId: string; name: string; bytes: number } | undefined
  try {
    if (process.env.DSH_NATIVE_SDK_PYTHON !== undefined) {
      const launcher = join(home, process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
      writeFileSync(launcher, process.platform === 'win32'
        ? `@echo off\r\n"${process.execPath}" "${join(root, 'rsh/Programs/CLI/lib/bin.js')}" %*\r\n`
        : `#!/bin/sh\nexec "${process.execPath}" "${join(root, 'rsh/Programs/CLI/lib/bin.js')}" "$@"\n`)
      if (process.platform !== 'win32') chmodSync(launcher, 0o700)
      const python = await execa(process.env.DSH_NATIVE_SDK_PYTHON, [join(scene, 'client.py'), launcher, home, workspace,
        patch, baseURL], { env: { ...process.env, PYTHONPATH: join(root, 'rsh/Programs/SDK/python/sdk/src'),
          NATIVE_SDK_FIXTURE_KEY: 'fixture-key' }, timeout: 60_000 })
      const result = JSON.parse(python.stdout) as { firstResult: unknown; coldResult: unknown; steeringId: string;
        firstReceipt: typeof firstReceipt; secondReceipt: typeof secondReceipt }
      firstResult = result.firstResult as { finalResponse: string }
      coldResult = result.coldResult as { finalResponse: string }
      steeringId = result.steeringId
      firstReceipt = result.firstReceipt
      secondReceipt = result.secondReceipt
    } else {
      const harness = new DeepSeekHarness(options)
      try {
        const session = harness.session(sessionId)
        firstReceipt = await session.uploadFile(firstBytes, 'first.txt')
        await expect(session.run([{ type: 'file', attachment: { attachmentId: `sha256:${'a'.repeat(64)}`,
          name: 'forged.txt', bytes: 1 } } as never])).rejects.toThrow(
          'content blocks must be text, encoded raster images, or staged file receipts')
        expect(requests).toHaveLength(0)
        const pending = session.run([
          { type: 'text', text: 'Read the staged first file and inspect the image.' },
          { type: 'image', data: imageBase64, mimeType: 'image/png' },
          { type: 'file', receiptId: firstReceipt.receiptId },
        ])
        await control(baseURL, '/await-initial')
        secondReceipt = await session.uploadFile(secondBytes, 'second.txt')
        steeringId = await session.steer([
          { type: 'text', text: 'Read the second staged file too.' },
          { type: 'file', receiptId: secondReceipt.receiptId },
        ])
        await control(baseURL, '/release-initial', 'POST')
        firstResult = await pending
      } finally { await harness.close() }
      const cold = new DeepSeekHarness(options)
      try { coldResult = await cold.session(sessionId).run('Cold-read the first staged file again.') }
      finally { await cold.close() }
    }

    expect(firstResult?.finalResponse).toBe('Both uploaded files were read.')
    expect(coldResult?.finalResponse).toBe('The restored first file is readable.')
    expect(steeringId).not.toBe('')
    expect(firstReceipt).toMatchObject({ name: 'first.txt', bytes: firstBytes.byteLength })
    expect(secondReceipt).toMatchObject({ name: 'second.txt', bytes: secondBytes.byteLength })
    expect(firstReceipt?.receiptId).not.toBe(secondReceipt?.receiptId)

    const paths = sessionFiles(sessions)
    expect(paths).toHaveLength(1)
    const physical = paths[0]
    if (physical === undefined) throw new Error('native-sdk staged-files: missing durable Session')
    const raw = readFileSync(physical, 'utf8')
    const events = parseSessionLog(raw)
    const initialInserts = events.filter(event => event.type === 'agent/inbox/spliced' && event.data.inserted.length > 0)
    const insertedMessages = initialInserts.flatMap(event => event.data.inserted)
    expect(insertedMessages.map(message => message.content.map(block => block.type))).toEqual([
      ['text', 'image', 'file'], ['text', 'file'], ['text'],
    ])
    expect(insertedMessages.map(message => message.content[0])).toEqual([
      { type: 'text', text: 'Read the staged first file and inspect the image.' },
      { type: 'text', text: 'Read the second staged file too.' },
      { type: 'text', text: 'Cold-read the first staged file again.' },
    ])
    const files = insertedMessages.flatMap(message => message.content.filter(block => block.type === 'file'))
    expect(files).toHaveLength(2)
    expect(files.map(block => ({ name: block.attachment.name, bytes: block.attachment.bytes }))).toEqual([
      { name: 'first.txt', bytes: firstBytes.byteLength }, { name: 'second.txt', bytes: secondBytes.byteLength },
    ])
    const images = insertedMessages.flatMap(message => message.content.filter(block => block.type === 'image'))
    expect(images).toHaveLength(1)
    const image = images[0]
    if (image?.type !== 'image') throw new Error('native-sdk staged-files: missing durable image reference')
    const attachments = new LocalAttachmentBackend({ dshHome: home })
    const firstHandle = fileHandle(requests[0] as ModelRequest, 'first.txt')
    const secondHandle = fileHandle(requests[1] as ModelRequest, 'second.txt')
    const normalizedImagePath = imageHandle(requests[0] as ModelRequest)
    expect(firstHandle).toBe(attachments.fileHostPath(files[0]!.attachment))
    expect(secondHandle).toBe(attachments.fileHostPath(files[1]!.attachment))
    expect(normalizedImagePath).toBe(attachments.imageHostPath(image.attachment))
    expect(relative(workspace, firstHandle).startsWith('..')).toBe(true)
    expect(relative(workspace, secondHandle).startsWith('..')).toBe(true)
    expect(relative(workspace, normalizedImagePath).startsWith('..')).toBe(true)
    const fixturePaths = pathMappings(home, [firstHandle, secondHandle, normalizedImagePath])
    const storedImage = await attachments.readImage(image.attachment)
    const storedImageBytes = Buffer.from(storedImage.data)
    expect(image.attachment.attachmentId).toBe(`sha256:${createHash('sha256').update(storedImageBytes).digest('hex')}`)
    for (const [index, block] of files.entries()) {
      if (block.type !== 'file') throw new Error('native-sdk staged-files: file receipt did not resolve to a FileBlock')
      const stored: Buffer[] = []
      for await (const chunk of attachments.readFileStream(block.attachment)) stored.push(Buffer.from(chunk))
      expect(Buffer.concat(stored)).toEqual(index === 0 ? firstBytes : secondBytes)
      expect(block.attachment.attachmentId).toContain(createHash('sha256').update(Buffer.concat(stored)).digest('hex'))
    }
    expect(events.filter(event => event.type === 'system/message')).toHaveLength(1)
    expect(events.filter(event => event.type === 'system/message')[0]).toMatchObject({ type: 'system/message', data: { turn: 1 } })
    expect(events.filter(event => event.type === 'request/header')).toMatchObject([
      { type: 'request/header', data: { reason: 'initial', header: { config: { provider: 'fixture', model: 'fixture-model' } } } },
      { type: 'request/header', data: { reason: 'resume', header: { config: { provider: 'fixture', model: 'fixture-model' } } } },
    ])
    expect(events.filter(event => event.type === 'turn/start').map(event => event.data.turn)).toEqual([1, 2])
    expect(events.filter(event => event.type === 'turn/end').map(event => event.data.turn)).toEqual([1, 2])

    const calls = events.filter(event => event.type === 'tool/call' && event.data.name === 'read_file')
    expect(calls).toHaveLength(3)
    const callPaths = calls.map(event => (JSON.parse(event.data.arguments) as { path: string }).path)
    expect(callPaths).toEqual([firstHandle, secondHandle, firstHandle])
    expect(modelMessages(requests[0] as ModelRequest)).toContain(`data:image/png;base64,${storedImageBytes.toString('base64')}`)
    expect(modelMessages(requests[2] as ModelRequest)).toContain('First staged attachment: alpha-attachment-bytes')
    expect(modelMessages(requests[2] as ModelRequest)).toContain('Second staged attachment: beta-attachment-bytes')
    expect(modelMessages(requests[4] as ModelRequest)).toContain('First staged attachment: alpha-attachment-bytes')
    const toolResults = JSON.stringify(events.filter(event => event.type === 'tool/result'))
    expect(toolResults).toContain('First staged attachment: alpha-attachment-bytes')
    expect(toolResults).toContain('Second staged attachment: beta-attachment-bytes')

    const backend = new JsonlSessionBackend({ root: sessions, compression: 'none' })
    try {
      const id = (await backend.list())[0]?.header.id
      if (id === undefined) throw new Error('native-sdk staged-files: cold Session missing')
      const reader = await backend.open(id, 'read')
      try { expect((await reader.read()).events).toEqual(events) }
      finally { await reader.close() }
    } finally { await backend.close() }

    const context = { cwd: workspace, sessionIds: [sessionId] }
    const normalized = normalizedFixture(raw, context, fixturePaths)
    const prompts = normalizedSystemPrompts(raw, context)
    const schemas = normalizedToolSchemas(raw, context)
    if (prompts[0] === undefined || schemas[0] === undefined) throw new Error('native-sdk staged-files: request header missing')
    const systemPrompt = formatSystemPromptSnapshot(prompts[0], prompts.slice(1))
    const toolSchemas = formatToolSchemasSnapshot(schemas[0], schemas.slice(1))
    const modelRequestSnapshot = JSON.stringify(modelSnapshot(requests, fixturePaths), null, 2) + '\n'
    if (process.env.DSH_SNAPSHOT === 'refresh') {
      writeFileSync(fixture, normalized)
      writeFileSync(join(scene, 'system-prompt.expected.md'), systemPrompt)
      writeFileSync(join(scene, 'tool-schemas.expected.json'), toolSchemas)
      writeFileSync(join(scene, 'model-requests.expected.json'), modelRequestSnapshot)
    } else {
      expect(normalized).toBe(readFileSync(fixture, 'utf8'))
      expect(systemPrompt).toBe(readFileSync(join(scene, 'system-prompt.expected.md'), 'utf8'))
      expect(toolSchemas).toBe(readFileSync(join(scene, 'tool-schemas.expected.json'), 'utf8'))
      expect(modelRequestSnapshot).toBe(readFileSync(join(scene, 'model-requests.expected.json'), 'utf8'))
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(home, { recursive: true, force: true })
  }
})

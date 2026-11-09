
import { describe, expect, it } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@redspark/rsh-llm/native'
import type { SessionId } from '@redspark/rsh-session/native'
import { brandString } from '@redspark/rsh-brand'
import type { NativeModel } from '@redspark/rsh-native-model-execution'
import { plugin } from '../src/native.ts'

const realFixture = 'snapshots/session/fs-read/session.v3.jsonl'

interface Provided { (name: string, value: unknown): void }

function install(request: Record<string, unknown>): NativeModel {
  const provided: { name: string; value: unknown }[] = []
  const provide: Provided = (name, value) => { provided.push({ name, value }) }
  const installer = plugin.resolve(request) as (context: { provide: Provided }) => void
  installer({ provide })
  const found = provided.find(entry => entry.name === 'model')
  if (found === undefined) throw new Error('native replay did not provide the model service')
  return found.value as NativeModel
}

function options(sessionId: string): GenerateOptions {
  return {
    provider: 'deepseek-official', model: 'deepseek-v4-flash', messages: [],
    sessionId: brandString<SessionId>(sessionId),
  }
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('native replay provider', () => {
  it('declares the model service and replays the recorded chunk stream', async () => {
    expect(plugin.provides).toEqual(['model'])
    const chunks = await collect(install({ file: realFixture }).stream(options('live-1')))
    expect(chunks.length).toBeGreaterThan(0)
    // Records stream bare StreamChunks, ending with exactly one terminal finish.
    expect(chunks.filter(chunk => chunk.type === 'finish')).toHaveLength(1)
    expect(chunks.at(-1)?.type).toBe('finish')
  })

  it('advances one cursor per scripted entry and reuses it across a session', async () => {
    const model = install({ file: realFixture })
    const first = await collect(model.stream(options('live-1')))
    const second = await collect(model.stream(options('live-1')))
    // fs-read recorded two assistant steps, so the second call replays the next entry.
    expect(second.length).toBeGreaterThan(0)
    expect(JSON.stringify(second)).not.toBe(JSON.stringify(first))
    await expect(collect(model.stream(options('live-1')))).rejects.toThrow(/exhausted/)
  })

  it('rejects a live session the recording does not contain', async () => {
    const model = install({ file: realFixture })
    await collect(model.stream(options('live-1')))
    await expect(collect(model.stream(options('live-2')))).rejects.toThrow(/does not contain/)
  })

  it('requires a fixture path', () => {
    const saved = process.env.RSH_SNAPSHOT_FILE
    delete process.env.RSH_SNAPSHOT_FILE
    try {
      expect(() => install({})).toThrow(/fixture path is required/)
    } finally {
      if (saved !== undefined) process.env.RSH_SNAPSHOT_FILE = saved
    }
  })

  it('rejects a negative pace', () => {
    expect(() => install({ file: realFixture, paceMs: -1 })).toThrow(/paceMs/)
  })
})

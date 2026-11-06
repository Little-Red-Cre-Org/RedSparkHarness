/**
 * Native `@` reference source.
 *
 * The Native half exists so a Native client finds files and sessions without
 * the browser's Remote namespace pair. What it must not do is invent different
 * rows, so these tests pin the projection against the shared module the browser
 * half reads, and pin the two discovery differences that are real: sessions come
 * from the durable list (filtered and ranked here rather than on the Host), and
 * the Host home arrives per connection generation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_FORMAT_VERSION, type SessionId } from '@redspark/rsh-session/types'
import { formatSessionReferenceMention } from '@redspark/rsh-session-reference'
import type { NativeSessionListItem } from '@redspark/rsh-client-native-session/native'
import { en, NS, zh } from '../src/client/locales.ts'
import {
  createReferenceSource, plugin, sessionCandidatesFor, type NativeReferenceFaces,
} from '../src/native.ts'

/** The `reference` dictionary with its one template parameter filled. */
const t = (key: keyof typeof en, params?: Record<string, unknown>): string => {
  const count = params?.n
  return en[key].replace(/\{n\}/gu, typeof count === 'number' ? String(count) : '')
}

const sid = (value: string): SessionId => value as SessionId
const CREATED_AT = 1_700_000_000_000
/** Three days after every fixture's createdAt, so age copy is one fixed bucket. */
const NOW = CREATED_AT + 3 * 86_400_000
const HOME = '/Users/dev'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => { vi.useRealTimers() })

function row(id: string, over: Partial<NativeSessionListItem> = {}): NativeSessionListItem {
  const row: NativeSessionListItem = {
    header: { version: SESSION_FORMAT_VERSION, id: sid(id), createdAt: CREATED_AT, isSeeded: false, cwd: `${HOME}/project` },
    titleProjection: { status: 'resolved', title: id.toUpperCase() },
    updatedAt: NOW - 3_600_000,
    blank: false, running: false, completed: false, runningSubagentCount: 0, hasActiveSchedule: false,
    ...over,
  }
  return row
}

function bench(options: {
  sessions?: readonly NativeSessionListItem[]
  files?: (sessionId: SessionId, query: string) => Promise<readonly { path: string; kind: 'file' | 'directory' }[]>
  home?: string | undefined
} = {}): { source: ReturnType<typeof createReferenceSource>; faces: NativeReferenceFaces; search: ReturnType<typeof vi.fn> } {
  const sessions = options.sessions ?? [row('target'), row('source')]
  const search = vi.fn(options.files ?? (async () => [
    { path: 'src', kind: 'directory' as const },
    { path: 'docs/a b.md', kind: 'file' as const },
  ]))
  const faces: NativeReferenceFaces = {
    conversation: {
      getSnapshot: () => ({ sessions, selected: sid('target'), events: [], state: 'ready' }) as never,
      subscribe: () => () => {},
    },
    files: { search },
    home: options.home ?? HOME,
  }
  return { source: createReferenceSource(faces, t), faces, search }
}

const request = (query: string, over: { quoted?: boolean; drilled?: boolean; signal?: AbortSignal } = {}) => ({
  query,
  quoted: over.quoted ?? false,
  position: 'inline' as const,
  drilled: over.drilled ?? false,
  signal: over.signal ?? new AbortController().signal,
})

const context = { sessionId: sid('target') }

describe('session candidates', () => {
  it('excludes the asking Session and ranks the same workspace first', () => {
    const candidates = sessionCandidatesFor([
      row('elsewhere', { header: { version: SESSION_FORMAT_VERSION, id: sid('elsewhere'), createdAt: CREATED_AT, isSeeded: false, cwd: '/other' } }),
      row('target'),
      row('sibling'),
      row('nocwd', { header: { version: SESSION_FORMAT_VERSION, id: sid('nocwd'), createdAt: CREATED_AT, isSeeded: false } }),
    ], sid('target'), '')
    expect(candidates.map(entry => entry.candidate.sessionId)).toEqual(['sibling', 'elsewhere', 'nocwd'])
    // The mention is the canonical one the browser resolver emits.
    expect(candidates[0]?.candidate.mention).toBe(formatSessionReferenceMention({ sessionId: sid('sibling'), label: 'SIBLING' }))
  })

  it('filters case-insensitively by title, id and workspace', () => {
    const rows = [row('target'), row('alpha-title'), row('beta')]
    expect(sessionCandidatesFor(rows, sid('target'), 'ALPHA').map(c => c.candidate.sessionId)).toEqual(['alpha-title'])
    expect(sessionCandidatesFor(rows, sid('target'), 'bet').map(c => c.candidate.sessionId)).toEqual(['beta'])
    expect(sessionCandidatesFor(rows, sid('target'), '/users/dev/project').map(c => c.candidate.sessionId)).toEqual(['alpha-title', 'beta'])
    expect(sessionCandidatesFor(rows, sid('target'), 'nothing-matches')).toEqual([])
  })

  it('labels a session without a resolved title by its id', () => {
    const candidates = sessionCandidatesFor(
      [row('target'), row('untitled', { titleProjection: { status: 'absent' } })],
      sid('target'), '',
    )
    expect(candidates.map(entry => entry.candidate.label)).toEqual(['untitled'])
  })
})

describe('candidates', () => {
  it('renders file rows before session rows with the shared labels and payloads', async () => {
    const { source, search } = bench()
    const rows = await source.candidates(context, request('s'))
    expect(search).toHaveBeenCalledWith(sid('target'), 's', expect.any(AbortSignal))
    expect(rows.map(row => row.name)).toEqual(['src/', 'a b.md', 'SOURCE'])
    expect(rows[0]).toMatchObject({ icon: 'folder', section: t('section.files'), drill: true })
    expect(rows[1]).toMatchObject({ description: 'docs', icon: 'file', section: t('section.files') })
    expect(rows[2]).toMatchObject({ icon: 'session', section: t('section.sessions') })
    // The asking Session shares the workspace, so its own location is not repeated.
    expect(rows[2]?.description).toBe('1h')
  })

  it('suppresses the session group for an open quoted path', async () => {
    const { source, search } = bench()
    // The query matches the listed session's label too, so only the quoted-path
    // suppression can keep that group out of the answer.
    const rows = await source.candidates(context, request('SOURCE', { quoted: true }))
    expect(rows.map(row => row.icon)).toEqual(['folder', 'file'])
    expect(search).toHaveBeenCalledWith(sid('target'), 'SOURCE', expect.any(AbortSignal))
  })

  it('treats a failed workspace search as an empty file group', async () => {
    const { source } = bench({ files: () => Promise.reject(new Error('gateway down')) })
    const rows = await source.candidates(context, request(''))
    expect(rows.map(row => row.name)).toEqual(['SOURCE'])
  })

  it('drops a settled result when the query signal was superseded', async () => {
    const controller = new AbortController()
    const { source } = bench()
    const pending = source.candidates(context, request('', { signal: controller.signal }))
    controller.abort()
    await expect(pending).resolves.toEqual([])
  })

  it('abbreviates a session workspace against the Host home', async () => {
    const { source } = bench({
      sessions: [row('target'), row('away', {
        header: { version: SESSION_FORMAT_VERSION, id: sid('away'), createdAt: CREATED_AT, isSeeded: false, cwd: '/Users/dev/other' },
      })],
    })
    const rows = await source.candidates(context, request(''))
    expect(rows.find(row => row.name === 'AWAY')?.description).toBe('~/other · 1h')
  })

  it('dates a session from its row activity time, not its creation time', async () => {
    // Ten days apart, so the two sources cannot produce the same bucket: a
    // fallback to createdAt would read '10d' instead of '1d'.
    const { source } = bench({
      sessions: [
        row('target'),
        row('stale', {
          header: { version: SESSION_FORMAT_VERSION, id: sid('stale'), createdAt: CREATED_AT - 10 * 86_400_000, isSeeded: false, cwd: `${HOME}/project` },
          updatedAt: CREATED_AT,
        }),
      ],
    })
    const rows = await source.candidates(context, request(''))
    expect(rows.find(row => row.name === 'STALE')?.description).toBe('3d')
  })
})

describe('directory header', () => {
  it('publishes crumbs only for a drilled listing', () => {
    const { source } = bench()
    expect(source.header?.(context, { query: 'src/module1/ind', drilled: true })).toEqual([
      expect.objectContaining({ label: t('crumb.root') }),
      expect.objectContaining({ label: 'src' }),
      expect.objectContaining({ label: 'module1', current: true }),
    ])
    expect(source.header?.(context, { query: 'src/module1/', drilled: false })).toBeUndefined()
  })
})

describe('pick', () => {
  /** The pick envelope the pipeline passes; only the row and the action vary per case. */
  const pick = (candidate: { name: string; value?: string }, action: 'pick' | 'drill') => ({
    candidate, session: context, position: 'inline' as const, via: 'menu' as const, action,
    span: { start: 0, end: 1, draftRev: 1 },
  })

  it('settles a file, a session and a folder as inserts; a drill keeps the menu open', async () => {
    const { source } = bench()
    const rows = await source.candidates(context, request(''))
    const [directory, file, session] = rows
    expect(source.onPick(pick(directory!, 'pick'))).toEqual({
      insert: { source: 'reference', ref: '@src/', label: 'src/', appearance: 'folder', clipboardText: '@src/' },
    })
    expect(source.onPick(pick(directory!, 'drill'))).toEqual({ text: '@src/', continue: true })
    expect(source.onPick(pick(file!, 'pick'))).toMatchObject({
      insert: { appearance: 'file', label: 'a b.md' },
    })
    expect(source.onPick(pick(session!, 'pick'))).toMatchObject({
      insert: { appearance: 'session', label: 'SOURCE' },
    })
  })

  it('ignores a row that carries no source-owned payload', () => {
    const { source } = bench()
    expect(source.onPick(pick({ name: 'foreign' }, 'pick'))).toBeUndefined()
  })

  it('round-trips a mention through the codec unchanged', async () => {
    const mention = formatSessionReferenceMention({ sessionId: sid('source'), label: 'Source' })
    const { source } = bench()
    expect(source.codec?.clipboardText(mention)).toBe(mention)
    await expect(source.codec?.serialize(mention, new AbortController().signal)).resolves.toBe(mention)
  })
})
describe('plugin', () => {
  function register(over: {
    connection?: { generation: { getSnapshot(): { host: { home: string } } | undefined } }
  } = {}) {
    const registered: unknown[] = []
    const dictionaries: unknown[] = []
    const own = vi.fn()
    const context = {
      require: (name: string) => {
        if (name === 'clientLocale') {
          return { register: (ns: string, dicts: unknown) => { dictionaries.push([ns, dicts]); return () => {} }, bind: () => t }
        }
        if (name === 'clientNativeInputTrigger') {
          return { registerSource: (source: unknown) => { registered.push(source); return () => {} } }
        }
        if (name === 'clientConnection') return over.connection ?? { generation: { getSnapshot: () => undefined } }
        if (name === 'clientNativeConversation') {
          return { getSnapshot: () => ({ sessions: [], events: [], state: 'ready' }), subscribe: () => () => {} }
        }
        return { search: async () => [] }
      },
      own,
    }
    void plugin.resolve(undefined)(context as never)
    return { registered, own, dictionaries }
  }

  it('registers the dictionaries and the source into the Native pipeline', () => {
    const bench = register()
    expect(bench.registered).toHaveLength(1)
    expect(bench.registered[0]).toMatchObject({ trigger: '@', name: 'reference', showGroupTitle: false })
    // The namespace and both dictionaries ride one locale registration, and the
    // installation owns both that registration and the source registration, so
    // the composition can withdraw them.
    expect(bench.dictionaries).toEqual([[NS, { en, zh }]])
    expect(bench.own).toHaveBeenCalledTimes(2)
  })

  it('reads the Host home from the current connection generation', async () => {
    let home = '/Users/dev'
    const conversation = {
      getSnapshot: () => ({
        sessions: [
          row('target'),
          row('away', { header: { version: SESSION_FORMAT_VERSION, id: sid('away'), createdAt: CREATED_AT, isSeeded: false, cwd: '/Users/dev/other' } }),
        ],
        events: [], state: 'ready',
      }),
      subscribe: () => () => {},
    }
    const registered: unknown[] = []
    const context = {
      require: (name: string) => {
        if (name === 'clientLocale') return { register: () => () => {}, bind: () => t }
        if (name === 'clientNativeInputTrigger') return { registerSource: (s: unknown) => { registered.push(s); return () => {} } }
        if (name === 'clientConnection') return { generation: { getSnapshot: () => ({ host: { home } }) } }
        if (name === 'clientNativeConversation') return conversation
        return { search: async () => [] }
      },
      own: () => {},
    }
    void plugin.resolve(undefined)(context as never)
    const source = registered[0] as {
      candidates(s: { sessionId: SessionId }, r: unknown): Promise<readonly { name: string; description?: string }[]>
    }
    const first = await source.candidates({ sessionId: sid('target') }, request(''))
    expect(first.find(entry => entry.name === 'AWAY')?.description).toBe('~/other · 1h')
    // A reconnect to another Host must re-read rather than keep the first value.
    home = '/home/elsewhere'
    const second = await source.candidates({ sessionId: sid('target') }, request(''))
    expect(second.find(entry => entry.name === 'AWAY')?.description).toBe('/Users/dev/other · 1h')
  })
})

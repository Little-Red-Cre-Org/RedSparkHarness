/** Native Web Host Remote protocol for strict list, put, conflict, and delete message feedback. */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import {
  assertFixtureInventory, compareOrRefreshGolden, fixtureIdentity, webSnapshotMode,
} from './scaffold.ts'
import { launchNativeWeb } from './native-scaffold.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../../../snapshots/web/message-feedback-protocol', import.meta.url))
const SESSION_FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const PROTOCOL_EXPECTED = join(SNAPSHOT_DIR, 'protocol.expected.json')
const SESSION_ID = 'message-feedback-protocol'
const MESSAGE_ID = fixtureIdentity('message', 2)
const MODE = webSnapshotMode()

interface ProtocolExchange {
  readonly endpoint: string
  readonly request: unknown
  readonly status: number
  readonly response: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Extract the opaque item version while keeping every surrounding wire field snapshot-owned. */
function createdVersion(response: unknown): string {
  if (!isRecord(response) || !isRecord(response.result) || response.result.ok !== true
    || !isRecord(response.result.value) || !isRecord(response.result.value.value)
    || typeof response.result.value.value.version !== 'string') {
    throw new Error('feedback/message-put did not return a successful versioned item')
  }
  return response.result.value.value.version
}

/** Replace only run-owned UUID/time values; all protocol names and business fields stay exact. */
function normalizeProtocol(exchanges: readonly ProtocolExchange[], version: string): string {
  return JSON.stringify(exchanges, (key, value: unknown) => {
    if (key === 'messageId' && value === MESSAGE_ID) return '{{message:2}}'
    if ((key === 'version' || key === 'ifVersion') && value === version) return '{{version}}'
    if ((key === 'createdAt' || key === 'updatedAt') && typeof value === 'number') return '{{timestamp}}'
    return value
  }, 2)
}

it.skipIf(MODE === 'record')('snapshots strict list, put, conflict, and delete calls through the shipped Native Web Host', async () => {
  const scaffold = await launchNativeWeb({ drop: ['pi-ai'], seed: { fixture: SESSION_FIXTURE, seedId: SESSION_ID } })
  try {
    const exchanges: ProtocolExchange[] = []
    const invoke = async (rpcId: string, endpoint: string, request: unknown): Promise<unknown> => {
      const response = await scaffold.page.request.post(new URL(`/api/${endpoint}`, scaffold.url).href, {
        headers: { 'content-type': 'application/json' },
        data: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: request }),
      })
      const body: unknown = await response.json()
      exchanges.push({ endpoint: `/api/${endpoint}`, request, status: response.status(), response: body })
      return body
    }

    await invoke('feedback-invalid', 'feedback/message-put', {
      sessionId: SESSION_ID,
      messageId: MESSAGE_ID,
      rating: 'invalid-rating',
      ifVersion: null,
    })
    await invoke('feedback-list-empty', 'feedback/message-list', { sessionId: SESSION_ID })
    const created = await invoke('feedback-put', 'feedback/message-put', {
      sessionId: SESSION_ID,
      messageId: MESSAGE_ID,
      rating: 'positive',
      note: 'Useful answer',
      ifVersion: null,
    })
    const version = createdVersion(created)
    expect(version).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    await invoke('feedback-list-created', 'feedback/message-list', { sessionId: SESSION_ID })
    await invoke('feedback-conflict', 'feedback/message-put', {
      sessionId: SESSION_ID,
      messageId: MESSAGE_ID,
      rating: 'negative',
      ifVersion: null,
    })
    await invoke('feedback-delete', 'feedback/message-delete', {
      sessionId: SESSION_ID,
      messageId: MESSAGE_ID,
      ifVersion: version,
    })
    await invoke('feedback-list-deleted', 'feedback/message-list', { sessionId: SESSION_ID })

    expect(exchanges.every(exchange => exchange.status === 200)).toBe(true)
    await compareOrRefreshGolden(PROTOCOL_EXPECTED, normalizeProtocol(exchanges, version), MODE)
    await assertFixtureInventory(SNAPSHOT_DIR, ['protocol.expected.json', 'session.v3.jsonl'], 'native-web')
  } finally {
    await scaffold.close()
  }
}, 120_000)

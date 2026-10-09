/** Native sole Provider composing SQLite search with exact Session queries. */

import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { createNativeSessionQueryRuntime, createNativeSessionQuerySource } from '@deepseek-ai/dsh-session-query/native'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query/native'
import type {} from '@deepseek-ai/dsh-session-projection-cache/native'
import {
  resolveSessionQuerySqliteConfig,
  SqliteSessionQueryCore,
  type ResolvedSessionQuerySqliteConfig,
  type SessionQuerySqliteConfig,
} from './core.ts'

const nativeConfigFields = new Set<keyof SessionQuerySqliteConfig>([
  'path',
  'openAt',
  'journalMode',
  'defaultLimit',
  'maxLimit',
  'snippetChars',
  'readWindowMax',
  'persistedReadConcurrency',
  'preparedSessionCacheSize',
])

/**
 * Resolve strict JSON config before activating the combined Native Provider.
 * @param input - Native profile configuration.
 * @returns validated SQLite and exact-query settings.
 */
export function resolveNativeSessionQuerySqliteConfig(input: unknown): ResolvedSessionQuerySqliteConfig {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw invalidNativeConfig('configuration must be an object')
  }
  for (const [key, value] of Object.entries(input)) {
    if (!nativeConfigFields.has(key as keyof SessionQuerySqliteConfig)) {
      throw invalidNativeConfig(`unknown configuration field ${key}`)
    }
    if (value === null) throw invalidNativeConfig(`${key} must not be null`)
  }
  return resolveSessionQuerySqliteConfig(input as SessionQuerySqliteConfig)
}

/** Native SQLite provider owns one exact source, search index, and query service. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-session-query-sqlite',
  targets: ['host'],
  requires: ['activeSessions'],
  optional: ['sessionPersistence', 'sessionProjections', 'sessionProjectionCache'],
  provides: ['sessionQuery'],
  resolve(input) {
    const config = resolveNativeSessionQuerySqliteConfig(input)
    return async (context) => {
      const source = createNativeSessionQuerySource(
        context.require('activeSessions'),
        context.optional('sessionPersistence'),
      )
      const core = new SqliteSessionQueryCore(config, source)
      const projections = context.optional('sessionProjections')
      const checkpointCache = context.optional('sessionProjectionCache')
      const runtime = createNativeSessionQueryRuntime(source, {
        readWindowMax: config.readWindowMax,
        persistedReadConcurrency: config.persistedReadConcurrency,
        preparedSessionCacheSize: config.preparedSessionCacheSize,
        ...(projections === undefined ? {} : { projections }),
        ...(checkpointCache === undefined ? {} : { checkpointCache }),
        search: core,
      })
      const close = closeRuntime(core, () => runtime.close())
      context.own(close)
      try {
        await core.open()
      } catch (failure: unknown) {
        try {
          await close()
        } catch (cleanupFailure: unknown) {
          throw new AggregateError([failure, cleanupFailure], 'session-query SQLite: startup and cleanup failed')
        }
        throw failure
      }
      context.provide('sessionQuery', runtime.operations)
    }
  },
}

function invalidNativeConfig(detail: string): SessionQueryError {
  return new SessionQueryError(`session-search Native config: ${detail}`, 'SESSION_QUERY_INVALID_CONFIG')
}

function closeRuntime(core: SqliteSessionQueryCore, closeExactRuntime: () => Promise<void>): () => Promise<void> {
  let closing: Promise<void> | undefined
  return () => {
    closing ??= (async () => {
      const outcomes = await Promise.allSettled([core.close(), closeExactRuntime()])
      const failures = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : [])
      if (failures.length > 0) throw new AggregateError(failures, 'session-query SQLite: Native teardown failed')
    })()
    return closing
  }
}

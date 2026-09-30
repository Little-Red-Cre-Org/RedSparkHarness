/** Native JSONL Session storage uses the released generation and single-writer backend. */
import { isAbsolute, resolve } from 'node:path'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { JsonlSessionBackend, type Config } from './backend.ts'

export { JsonlSessionBackend }

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    sessionPersistence: JsonlSessionBackend
  }
}

function resolveConfig(input: unknown): Config {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('session-persistence-jsonl: configuration must be an object')
  }
  const fields = input as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (key !== 'root' && key !== 'compression') throw new Error(`session-persistence-jsonl: unknown configuration field ${key}`)
  }
  if (typeof fields.root !== 'string' || fields.root.length === 0 || !isAbsolute(fields.root)) {
    throw new Error('session-persistence-jsonl: root must be an absolute path')
  }
  if (fields.compression !== undefined && fields.compression !== 'none' && fields.compression !== 'zstd') {
    throw new Error('session-persistence-jsonl: compression must be none or zstd')
  }
  return {
    root: resolve(fields.root),
    ...fields.compression === undefined ? {} : { compression: fields.compression },
  }
}

/** Explicit native storage provider; closing waits for all owned handles to drain. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-session-persistence-jsonl',
  targets: ['host'],
  requires: [],
  provides: ['sessionPersistence'],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      const backend = new JsonlSessionBackend(config)
      context.own(() => backend.close())
      context.provide('sessionPersistence', backend)
    }
  },
}

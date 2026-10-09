/** Native local-workspace file-reference Provider using the selected filesystem. */
import { z } from 'zod'
import type { NativeAgent } from '@deepseek-ai/dsh-native-agent'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type {} from '@deepseek-ai/dsh-native-session-execution/native'
import type {} from '@deepseek-ai/dsh-native-tools/native'
import type {} from '@deepseek-ai/dsh-native-prompt/native'
import type { FileSystemOperations } from '@deepseek-ai/dsh-fs/native'
import type { NativeFileReferenceOperations } from '@deepseek-ai/dsh-file-reference/native'
import type { Session } from '@deepseek-ai/dsh-session/native'
import {
  DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES,
  DEFAULT_FILE_SEARCH_MAX_ENTRIES,
  DEFAULT_FILE_SEARCH_MAX_RESULTS,
  FileReferenceSearchIndex,
  type FileReferenceDirectoryEntry,
  type FileReferenceSearchConfig,
  type FileReferenceSearchReader,
} from '@deepseek-ai/dsh-file-reference/search'
import { FILE_REFERENCE_PROMPT } from '@deepseek-ai/dsh-file-reference/prompt'

const positiveSafeInteger = z.number().int().positive().refine(Number.isSafeInteger)
const configSchema = z.object({
  maxResults: positiveSafeInteger.default(DEFAULT_FILE_SEARCH_MAX_RESULTS),
  maxEntries: positiveSafeInteger.default(DEFAULT_FILE_SEARCH_MAX_ENTRIES),
  excludedDirectories: z.array(z.string()).default([...DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES]),
}).strict()

class NativeWorkspaceReader implements FileReferenceSearchReader {
  private workspace: Promise<Awaited<ReturnType<FileSystemOperations['resolve']>>> | undefined
  private readonly pending = new Set<Promise<unknown>>()

  constructor(private readonly fs: FileSystemOperations, private readonly cwd: string) {}

  listDirectory(directory: string, signal: AbortSignal): Promise<readonly FileReferenceDirectoryEntry[]> {
    const operation = this.readDirectory(directory, signal)
    this.pending.add(operation)
    const settled = (): void => { this.pending.delete(operation) }
    void operation.then(settled, settled)
    return operation
  }

  async drain(): Promise<void> {
    await Promise.allSettled([...this.pending])
  }

  private async readDirectory(directory: string, signal: AbortSignal): Promise<readonly FileReferenceDirectoryEntry[]> {
    signal.throwIfAborted()
    const workspace = await this.workspaceTarget(signal)
    if (directory.startsWith('/') || /^[A-Za-z]:\//u.test(directory)) return []
    let current = ''
    for (const segment of directory.split('/').filter(Boolean)) {
      if (segment === '.' || segment === '..') return []
      current = `${current}${segment}/`
      const directoryInfo = await this.fs.lstat(current, { cwd: this.cwd }, signal)
      if (directoryInfo?.type !== 'directory') return []
      const target = await this.fs.resolve(current, { cwd: this.cwd, signal })
      if (!this.fs.contains(workspace, target)) return []
    }
    const target = current === '' ? workspace : await this.fs.resolve(current, { cwd: this.cwd, signal })
    const entries = await this.fs.listDir(target, signal)
    const candidates: FileReferenceDirectoryEntry[] = []
    for (const entry of entries) {
      signal.throwIfAborted()
      if (entry.type !== 'file' && entry.type !== 'directory') continue
      const path = `${directory}${entry.name}`
      const pathInfo = await this.fs.lstat(path, { cwd: this.cwd }, signal)
      if (pathInfo?.type !== entry.type) continue
      const child = await this.fs.resolve(path, { cwd: this.cwd, signal })
      if (!this.fs.contains(workspace, child)) continue
      candidates.push({ name: entry.name, kind: entry.type })
    }
    return candidates
  }

  private async workspaceTarget(signal: AbortSignal) {
    if (this.workspace === undefined) {
      const operation = this.fs.resolve('.', { cwd: this.cwd, signal })
      this.workspace = operation
      try {
        return await operation
      } catch (error: unknown) {
        if (this.workspace === operation) this.workspace = undefined
        throw error
      }
    }
    return this.workspace
  }
}

class OwnerWorkspaceSearch {
  readonly index: FileReferenceSearchIndex
  readonly reader: NativeWorkspaceReader
  readonly controller = new AbortController()
  readonly pending = new Set<Promise<unknown>>()
  readonly removeEvent: () => void
  closing = false
  close: Promise<void> | undefined

  constructor(fs: FileSystemOperations, owner: NativeActiveSessionOwner, config: FileReferenceSearchConfig) {
    this.reader = new NativeWorkspaceReader(fs, owner.session.header.cwd ?? process.cwd())
    this.index = new FileReferenceSearchIndex(this.reader, config)
    this.removeEvent = owner.onEvent((event) => {
      if (event.type === 'tool/result') this.index.invalidate()
    })
  }

  list(query: string, signal: AbortSignal) {
    if (this.closing) return Promise.resolve([])
    const operation = this.index.list(query, AbortSignal.any([signal, this.controller.signal]))
    this.pending.add(operation)
    const settled = (): void => { this.pending.delete(operation) }
    void operation.then(settled, settled)
    return operation
  }

  closeAndDrain(): Promise<void> {
    if (this.close !== undefined) return this.close
    this.closing = true
    this.controller.abort(new Error('native-file-reference-local: active Session detached'))
    this.index.dispose()
    return this.close = (async () => {
      await Promise.allSettled([...this.pending])
      await this.reader.drain()
      this.removeEvent()
    })()
  }
}

/** Register the Native file-reference service and its conditional model guidance. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-native-file-reference-local',
  targets: ['host'],
  requires: ['fs', 'activeSessions', 'tools', 'promptSections'],
  provides: ['fileReferences'],
  resolve(input) {
    const config = configSchema.parse(input ?? {})
    if (config.excludedDirectories.some(name => name.length === 0 || name.includes('/') || name.includes('\\'))) {
      throw new Error('native-file-reference-local: excludedDirectories entries must be non-empty directory basenames')
    }
    return async (context) => {
      const fs = context.require('fs')
      const activeSessions = context.require('activeSessions')
      const tools = context.require('tools')
      const promptSections = context.require('promptSections')
      const owners = new Map<NativeActiveSessionOwner, OwnerWorkspaceSearch>()
      const resolved: FileReferenceSearchConfig = {
        maxResults: config.maxResults,
        maxEntries: config.maxEntries,
        excludedDirectories: config.excludedDirectories,
      }

      const attach = (owner: NativeActiveSessionOwner): Promise<void> => {
        if (!owners.has(owner)) owners.set(owner, new OwnerWorkspaceSearch(fs, owner, resolved))
        return Promise.resolve()
      }
      const detach = async (owner: NativeActiveSessionOwner): Promise<void> => {
        const search = owners.get(owner)
        if (search === undefined) return
        owners.delete(owner)
        await search.closeAndDrain()
      }
      context.effect(activeSessions.onAttached(attach))
      context.effect(activeSessions.onDetached(detach))
      context.effect(promptSections.register({
        name: 'context:file-reference',
        order: 900,
        text: (scope, context) => {
          const readVisible = tools.modelSchemas(scope).some(tool => tool.name === 'read')
            && (context?.allowedTools === undefined || context.allowedTools.includes('read'))
          return readVisible ? FILE_REFERENCE_PROMPT : ''
        },
      }, context.scope))
      context.provide('fileReferences', {
        list(agent: NativeAgent, session: Session, query: string, signal: AbortSignal) {
          if (!context.scope.contains(agent.scope)) {
            throw new Error('native-file-reference-local: Agent scope is outside this Provider')
          }
          const owner = activeSessions.owner(agent, session)
          if (owner === undefined) throw new Error('native-file-reference-local: Agent and Session have no active owner')
          const search = owners.get(owner)
          if (search === undefined) throw new Error('native-file-reference-local: active owner was not attached')
          return search.list(query, signal)
        },
      } satisfies NativeFileReferenceOperations)
      context.own(async () => {
        await Promise.all([...owners.values()].map(search => search.closeAndDrain()))
        owners.clear()
      })
      for (const owner of activeSessions.owners()) await attach(owner)
    }
  },
}

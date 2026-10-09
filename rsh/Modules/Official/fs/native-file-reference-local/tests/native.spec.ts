/** Native file-reference Provider over one selected filesystem and active Session owner. */
import { lstat, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { plugin as promptPlugin, type NativePromptRegistry } from '@deepseek-ai/dsh-native-prompt'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeToolRegistry } from '@deepseek-ai/dsh-native-tools'
import { NativeAgentId } from '@deepseek-ai/dsh-native-agent'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import type { SessionEvent } from '@deepseek-ai/dsh-session/native'
import type { NativeFileReferenceOperations } from '@deepseek-ai/dsh-file-reference/native'
import type { FileSystemOperations } from '@deepseek-ai/dsh-fs/native'
import { localFilesystemPlugin } from '../../fs-local/src/native.ts'
import { plugin as fileReferencePlugin } from '../src/native.ts'
import { FILE_REFERENCE_PROMPT } from '../../../../../Engine/context/file-reference/src/prompt.ts'

class ActiveSessionsFixture implements NativeActiveSessionOperations {
  private readonly current = new Set<NativeActiveSessionOwner>()
  private readonly attached = new Set<(owner: NativeActiveSessionOwner) => Promise<void>>()
  private readonly detached = new Set<(owner: NativeActiveSessionOwner) => Promise<void>>()

  async register(owner: NativeActiveSessionOwner): Promise<() => Promise<void>> {
    await this.attach(owner)
    let release: Promise<void> | undefined
    return () => release ??= this.detach(owner)
  }

  owner(agent: NativeActiveSessionOwner['agent'], session: NativeActiveSessionOwner['session']) {
    return [...this.current].find(owner => owner.agent === agent && owner.session === session)
  }

  owners(): readonly NativeActiveSessionOwner[] { return [...this.current] }

  onAttached(observer: (owner: NativeActiveSessionOwner) => Promise<void>): () => Promise<void> {
    this.attached.add(observer)
    return async () => { this.attached.delete(observer) }
  }

  onDetached(observer: (owner: NativeActiveSessionOwner) => Promise<void>): () => Promise<void> {
    this.detached.add(observer)
    return async () => { this.detached.delete(observer) }
  }

  async attach(owner: NativeActiveSessionOwner): Promise<void> {
    this.current.add(owner)
    await Promise.all([...this.attached].map(observer => observer(owner)))
  }

  async detach(owner: NativeActiveSessionOwner): Promise<void> {
    this.current.delete(owner)
    await Promise.all([...this.detached].map(observer => observer(owner)))
  }
}

function owner(workspace: string, id: string, parent: NativeScope): NativeActiveSessionOwner {
  const scope = new NativeScope(parent)
  const sessionId = SessionId(id)
  const session = Session.create(sessionId, undefined, {
    id: sessionId, version: SESSION_FORMAT_VERSION, createdAt: 1, cwd: workspace, isSeeded: false,
  })
  const agent = { id: NativeAgentId(id), scope }
  const observers = new Set<(event: SessionEvent) => void>()
  return {
    agent, session, invocation: 'root', inheritedEventCount: 0, writerAvailable: true,
    onEvent(observer: (event: SessionEvent) => void) { observers.add(observer); return () => { observers.delete(observer) } },
  } as unknown as NativeActiveSessionOwner
}

it('lists through the selected filesystem, gates its prompt on read, and drains detached searches', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'rsh-native-file-reference-'))
  const outside = await mkdtemp(join(tmpdir(), 'rsh-native-file-reference-outside-'))
  await writeFile(join(workspace, 'README.md'), 'workspace file')
  await writeFile(join(workspace, 'zzz.md'), 'later workspace file')
  await mkdir(join(outside, 'nested'))
  await writeFile(join(outside, 'nested', 'outside-secret.md'), 'outside file')
  let linked = false
  try {
    try {
      await symlink(outside, join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
      linked = true
    } catch {
      // The listing assertions below still exercise the selected filesystem; Windows may deny links.
    }

    const scope = new NativeScope()
    const active = new ActiveSessionsFixture()
    const initialOwner = owner(workspace, 'file-reference-initial', scope)
    await active.attach(initialOwner)
    const tools = { modelSchemas: () => [{ name: 'read' }] } as unknown as NativeToolRegistry
    const activeProvider: NativePlugin = {
      apiVersion: 1, name: 'file-reference-test-active-sessions', targets: ['host'], requires: [], provides: ['activeSessions'],
      resolve: () => (context) => { context.provide('activeSessions', active) },
    }
    const toolsProvider: NativePlugin = {
      apiVersion: 1, name: 'file-reference-test-tools', targets: ['host'], requires: [], provides: ['tools'],
      resolve: () => (context) => { context.provide('tools', tools) },
    }
    let filesystem: FileSystemOperations | undefined
    let references: NativeFileReferenceOperations | undefined
    let promptSections: NativePromptRegistry | undefined
    const capture: NativePlugin = {
      apiVersion: 1, name: 'file-reference-test-capture', targets: ['host'],
      requires: ['fs', 'fileReferences', 'promptSections'], provides: [],
      resolve: () => (context) => {
        filesystem = context.require('fs')
        references = context.require('fileReferences')
        promptSections = context.require('promptSections')
      },
    }
    const host = new NativeHost(resolveInstallation([
      { plugin: capture, scope, config: undefined },
      { plugin: fileReferencePlugin, scope, config: { maxEntries: 1 } },
      { plugin: promptPlugin, scope, config: undefined },
      { plugin: toolsProvider, scope, config: undefined },
      { plugin: activeProvider, scope, config: undefined },
      { plugin: localFilesystemPlugin, scope, config: { cwd: workspace } },
    ], 'host'))
    try {
      await host.start()
      const selectedFilesystem = filesystem
      const selectedReferences = references
      const selectedPromptSections = promptSections
      if (selectedFilesystem === undefined || selectedReferences === undefined || selectedPromptSections === undefined) {
        throw new Error('Native file-reference Provider did not publish its selected services')
      }
      const signal = new AbortController().signal
      expect(await selectedReferences.list(initialOwner.agent, initialOwner.session, 'README.md', signal))
        .toEqual([{ path: 'README.md', kind: 'file' }])
      let reverseDirectoryOrder = false
      const listDirectory = selectedFilesystem.listDir.bind(selectedFilesystem)
      selectedFilesystem.listDir = async (target, listSignal) => {
        const entries = [...await listDirectory(target, listSignal)]
          .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
        return reverseDirectoryOrder ? entries.reverse() : entries
      }
      const firstOrder = await selectedReferences.list(initialOwner.agent, initialOwner.session, 'README', signal)
      expect(firstOrder).toEqual([{ path: 'README.md', kind: 'file' }])
      const reversedOwner = owner(workspace, 'file-reference-reversed-order', scope)
      await active.detach(initialOwner)
      reverseDirectoryOrder = true
      await active.attach(reversedOwner)
      expect(await selectedReferences.list(reversedOwner.agent, reversedOwner.session, 'README', signal)).toEqual(firstOrder)
      if (linked && await lstat(join(workspace, 'escape')).then(() => true, () => false)) {
        expect(await selectedReferences.list(reversedOwner.agent, reversedOwner.session, 'escape/', signal)).toEqual([])
      }
      expect(await selectedPromptSections.render(reversedOwner.agent.scope)).toContain(FILE_REFERENCE_PROMPT)
      expect(await selectedPromptSections.render(reversedOwner.agent.scope, { allowedTools: [] })).toBe('')

      const pendingOwner = owner(workspace, 'file-reference-pending', scope)
      await active.attach(pendingOwner)
      const entered = Promise.withResolvers<undefined>()
      const unblock = Promise.withResolvers<undefined>()
      const orderedListDirectory = selectedFilesystem.listDir.bind(selectedFilesystem)
      selectedFilesystem.listDir = async (target, listSignal) => {
        entered.resolve(undefined)
        await unblock.promise
        return orderedListDirectory(target, listSignal)
      }
      const pending = selectedReferences.list(pendingOwner.agent, pendingOwner.session, 'README', signal)
      await entered.promise
      let detached = false
      const detaching = active.detach(pendingOwner).then(() => { detached = true })
      await Promise.resolve()
      expect(detached).toBe(false)
      unblock.resolve(undefined)
      await detaching
      await expect(pending).rejects.toThrow()
      expect(() => selectedReferences.list(pendingOwner.agent, pendingOwner.session, 'README', signal))
        .toThrow('no active owner')
    } finally {
      await host.stop()
    }
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

/** Read-only inspection helpers for native JSONL Session storage. */

import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseGenerationLogFilename, type JsonlCompression } from './generation-format.ts'

/**
 * Identify the encoding used by committed live or retained generations under one Session root.
 * @param root - the shared Session root configured by a provider.
 * @returns its committed generation encoding, or `undefined` when no generations exist.
 * @throws when generations use mixed encodings, the live layout is obsolete, or the root cannot be read.
 */
export async function inspectSessionRootCompression(root: string): Promise<JsonlCompression | undefined> {
  let projects: Dirent[]
  try {
    projects = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return undefined
    throw error
  }

  let selected: JsonlCompression | undefined
  const select = (compression: JsonlCompression, path: string): void => {
    if (selected !== undefined && selected !== compression) {
      throw new Error(`session-persistence-jsonl: session root contains mixed compression generations at ${path}`)
    }
    selected = compression
  }
  const hasLogSuffix = (name: string): boolean => name.endsWith('.jsonl') || name.endsWith('.jsonl.zstd')
  const inspectGenerations = (directory: string, entries: Dirent[]): void => {
    for (const artifact of entries) {
      const plain = parseGenerationLogFilename(artifact.name, 'none')
      const compressed = parseGenerationLogFilename(artifact.name, 'zstd')
      if (plain === undefined && compressed === undefined) continue
      if (!artifact.isFile() && !artifact.isSymbolicLink()) {
        throw new Error(`session-persistence-jsonl: committed generation is not a file at ${join(directory, artifact.name)}`)
      }
      select(plain === undefined ? 'zstd' : 'none', join(directory, artifact.name))
    }
  }

  for (const project of projects) {
    if (project.name === '.rsh-session-ownership') continue
    const projectPath = join(root, project.name)
    if (project.name === '.rsh-session-trash') {
      if (!project.isDirectory()) throw new Error(`session-persistence-jsonl: retained Session root is not a directory at ${projectPath}`)
      for (const retained of await readdir(projectPath, { withFileTypes: true })) {
        if (!retained.isDirectory()) continue
        const payload = join(projectPath, retained.name, 'payload')
        try {
          inspectGenerations(payload, await readdir(payload, { withFileTypes: true }))
        } catch (error) {
          if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error
        }
      }
      continue
    }
    if (!project.isDirectory()) continue
    const sessions = await readdir(projectPath, { withFileTypes: true })
    const flatArtifact = sessions.find(entry => entry.isFile() && hasLogSuffix(entry.name))
    if (flatArtifact !== undefined) {
      throw new Error(`session-persistence-jsonl: legacy flat session artifact cannot identify a root encoding at ${join(projectPath, flatArtifact.name)}`)
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue
      const sessionPath = join(projectPath, session.name)
      inspectGenerations(sessionPath, await readdir(sessionPath, { withFileTypes: true }))
    }
  }
  return selected
}

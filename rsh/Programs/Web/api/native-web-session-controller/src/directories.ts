/** Authenticated native directory chooser and filesystem browser operations. */
import { mkdir, readdir, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, posix, resolve, win32 } from 'node:path'
import { pickNativeDirectory } from '@deepseek-ai/dsh-host-directory-picker-native/native-picker'
import type { NativeDirectoryEntry, NativeDirectoryListing } from '@deepseek-ai/dsh-client-native-session/workspaces'
import { z } from 'zod'

const empty = z.strictObject({})
const listRequest = z.strictObject({ path: z.string().optional() })
const createRequest = z.strictObject({
  path: z.string().min(1), name: z.string().refine(name => name.trim() !== '' && name !== '.' && name !== '..' && !/[/\\]/.test(name)),
})

function fullyQualified(path: string): boolean {
  return process.platform === 'win32'
    ? win32.isAbsolute(path) && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(path)
    : posix.isAbsolute(path)
}

function crumbs(target: string): NativeDirectoryListing['crumbs'] {
  const result: { name: string; path: string }[] = []
  let current = target
  for (;;) {
    const parent = dirname(current)
    result.unshift({ name: parent === current ? current : basename(current), path: current })
    if (parent === current) return result
    current = parent
  }
}

async function entry(parent: string, item: Dirent): Promise<NativeDirectoryEntry | undefined> {
  const path = join(parent, item.name)
  if (item.isDirectory()) return { name: item.name, path, kind: 'directory' }
  if (item.isFile()) return { name: item.name, path, kind: 'file' }
  if (!item.isSymbolicLink()) return undefined
  try {
    const target = await stat(path)
    if (target.isDirectory()) return { name: item.name, path, kind: 'directory' }
    if (target.isFile()) return { name: item.name, path, kind: 'file' }
  } catch { return undefined }
  return undefined
}

/** Native Web RPC owner for the Host's OS folder chooser and directory browser. */
export class NativeWebDirectoryService {
  /** @param lifetime - Host installation cancellation. */
  constructor(private readonly lifetime: AbortSignal) {}

  /** Handle one authenticated directory request.
   * @param endpoint - directory RPC endpoint.
   * @param payload - untrusted request fields.
   * @param signal - carrier cancellation.
   * @returns the Host result with a stable native directory failure code.
   */
  async handle(
    endpoint: string, payload: unknown, signal: AbortSignal,
  ): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string; details: object } }> {
    try {
      const accepted = AbortSignal.any([this.lifetime, signal])
      accepted.throwIfAborted()
      if (endpoint === 'directories/pick') {
        empty.parse(payload)
        return { ok: true, value: await pickNativeDirectory(accepted) }
      }
      if (endpoint === 'directories/list') {
        const request = listRequest.parse(payload)
        if (request.path !== undefined && !fullyQualified(request.path)) throw new Error('Directory path must be fully qualified')
        const path = resolve(request.path ?? homedir())
        const items = await readdir(path, { withFileTypes: true })
        accepted.throwIfAborted()
        const entries = (await Promise.all(items.map(item => entry(path, item))))
          .filter((item): item is NativeDirectoryEntry => item !== undefined)
          .sort((left, right) => left.name.localeCompare(right.name))
        return { ok: true, value: { path, entries, crumbs: crumbs(path) } satisfies NativeDirectoryListing }
      }
      if (endpoint === 'directories/create-directory') {
        const request = createRequest.parse(payload)
        if (!fullyQualified(request.path)) throw new Error('Directory path must be fully qualified')
        const target = join(resolve(request.path), request.name)
        await mkdir(target)
        return { ok: true, value: target }
      }
      throw new Error('Unsupported directory request')
    } catch {
      return { ok: false, error: { code: 'native/directories', message: 'Directory request failed.', details: {} } }
    }
  }
}

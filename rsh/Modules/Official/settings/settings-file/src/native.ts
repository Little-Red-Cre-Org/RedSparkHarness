/** Native file-backed settings Provider. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { Document, parseDocument } from 'yaml'
import { patchNode } from './yaml-patch.ts'
import { watch as watchFile } from 'chokidar'
import { NativeSettings, type NativeSettingsSection } from '@deepseek-ai/dsh-settings/native'

interface NativeConfig {
  path?: string
  dshHome?: string
  watch?: boolean
  debounceMs?: number
}

/**
 * Validate the native file-provider configuration.
 * @param input - untrusted native plugin configuration.
 * @returns the validated path configuration.
 */
export function resolveNativeSettingsConfig(input: unknown): NativeConfig {
  if (input === undefined) return {}
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new TypeError('settings-file: native configuration must be an object')
  const value = input as Record<string, unknown>
  for (const key of Object.keys(value)) {
    if (!['path', 'dshHome', 'watch', 'debounceMs'].includes(key)) throw new TypeError('settings-file: unknown native configuration field ' + JSON.stringify(key))
  }
  if (value['path'] !== undefined && typeof value['path'] !== 'string') throw new TypeError('settings-file: path must be a string')
  if (value['dshHome'] !== undefined && typeof value['dshHome'] !== 'string') throw new TypeError('settings-file: dshHome must be a string')
  if (value['watch'] !== undefined && typeof value['watch'] !== 'boolean') throw new TypeError('settings-file: watch must be a boolean')
  if (value['debounceMs'] !== undefined && (typeof value['debounceMs'] !== 'number' || !Number.isFinite(value['debounceMs']) || value['debounceMs'] < 0)) {
    throw new TypeError('settings-file: debounceMs must be a non-negative finite number')
  }
  return {
    ...(value['path'] === undefined ? {} : { path: value['path'] }),
    ...(value['dshHome'] === undefined ? {} : { dshHome: value['dshHome'] }),
    ...(value['watch'] === undefined ? {} : { watch: value['watch'] }),
    ...(value['debounceMs'] === undefined ? {} : { debounceMs: value['debounceMs'] }),
  }
}

/** Native file-backed settings Provider selected by native Host profiles. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-settings-file',
  targets: ['host'],
  requires: [],
  provides: ['settings'],
  resolve(input) {
    const config = resolveNativeSettingsConfig(input)
    const configuredFilename = config.path === undefined ? undefined : resolve(config.path)
    const extension = extname(configuredFilename ?? 'settings.yaml').toLowerCase()
    if (!['.yaml', '.yml', '.json'].includes(extension)) {
      throw new Error('settings-file: extension "' + extension + '" is not supported (use .yaml, .yml, or .json)')
    }
    const format = extension === '.json' ? 'json' : 'yaml'
    const watch = config.watch ?? true
    const debounceMs = config.debounceMs ?? 100
    return async (context) => {
      const [{ withFileLock, writeFileAtomic }, { resolveDshHome }] = await Promise.all([
        import('@deepseek-ai/dsh-atomic-write'),
        import('@deepseek-ai/dsh-home-paths'),
      ])
      const filename = configuredFilename ?? resolve(join(resolveDshHome(config.dshHome), 'settings.yaml'))
      let closed = false
      const settings = new NativeSettings({
        load: () => readDocument(filename, format),
        persist: async (update) => {
          await mkdir(dirname(filename), { recursive: true, mode: 0o700 })
          return withFileLock(filename, async () => {
            const currentText = await readDocumentText(filename)
            const current = parseSettingsDocument(currentText, filename, format)
            const next = update(current)
            let text: string
            if (format === 'json') text = JSON.stringify(next, null, 2) + '\n'
            else {
              const document = currentText.trim().length === 0 ? new Document(next) : parseDocument(currentText)
              patchNode(document, [], current, next)
              text = document.toString()
            }
            await writeFileAtomic(filename, text, { mode: 0o600, dirMode: 0o700 })
            return next
          })
        },
      })
      context.own(() => settings.dispose())
      await settings.start()
      await mkdir(dirname(filename), { recursive: true, mode: 0o700 })
      await withFileLock(filename, async () => {
        try {
          await writeFile(filename, '', { flag: 'wx', mode: 0o600 })
        } catch (error) {
          if ((error as NodeJS.ErrnoException | null)?.code !== 'EEXIST') throw error
        }
      })
      const watcher = watch ? watchFile(filename, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: debounceMs, pollInterval: Math.max(1, Math.min(debounceMs, 10)) },
      }) : undefined
      if (watcher !== undefined) {
        watcher.on('all', () => {
          if (closed) return
          void settings.reload().catch((error: unknown) => {
            console.warn('settings-file: external document reload failed', error)
          })
        })
        watcher.on('error', (error: unknown) => {
          console.warn('settings-file: watcher failed', error)
        })
        try {
          await new Promise<void>((resolveReady, rejectReady) => {
            watcher.once('ready', resolveReady)
            watcher.once('error', rejectReady)
          })
          await settings.reload()
        } catch (error) {
          await watcher.close()
          throw error
        }
        context.own(async () => {
          closed = true
          await watcher.close()
        })
      }
      context.provide('settings', settings)
    }
  },
}

async function readDocument(filename: string, format: 'yaml' | 'json'): Promise<NativeSettingsSection> {
  return parseSettingsDocument(await readDocumentText(filename), filename, format)
}

async function readDocumentText(filename: string): Promise<string> {
  try {
    return await readFile(filename, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return ''
    throw error
  }
}

function parseSettingsDocument(text: string, filename: string, format: 'yaml' | 'json'): NativeSettingsSection {
  if (text.trim().length === 0) return {}
  let value: unknown
  if (format === 'json') {
    try { value = JSON.parse(text) as unknown }
    catch { throw new Error(`settings-file: invalid JSON document at ${filename}`) }
  } else {
    const document = parseDocument(text, { prettyErrors: true })
    if (document.errors.length > 0) {
      const locations = document.errors.map((error) => {
        const at = error.linePos?.[0]
        return `${error.code}${at === undefined ? '' : ` at line ${at.line}, column ${at.col}`}`
      })
      throw new Error(`settings-file: invalid YAML document at ${filename}: ${locations.join('; ')}`)
    }
    value = document.toJS() as unknown
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('settings-file: ' + filename + ' must be a map of namespace sections')
  }
  return value as NativeSettingsSection
}

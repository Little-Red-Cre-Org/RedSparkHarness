/**
 * Electron child-process entry: boots the desktop project without a listening
 * socket and carries API plus validated Web assets over framed byte pipes.
 * @module @deepseek-ai/dsh-desktop-host
 */

import { mkdirSync, readFileSync } from 'node:fs'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { profileDirectoryRuntime } from '@deepseek-ai/dsh/native-profile'
import type { DesktopHostRuntime } from './runtime.ts'
import { openDesktopHostPipes } from './pipes.ts'
import {
  DESKTOP_HOST_PROTOCOL_VERSION,
  DESKTOP_PIPE_CHUNK_BYTES,
  DesktopHostRequestDecoder,
  encodeDesktopResponseData,
  encodeDesktopResponseEnd,
  encodeDesktopResponseError,
  encodeDesktopResponseStart,
  type DesktopHostRequestFrame,
} from './wire.ts'

export { DESKTOP_HOST_PROTOCOL_VERSION } from './wire.ts'

/** One request forwarded from Electron's `dsh-app://` handler. */
export interface DesktopHostFetchCommand {
  readonly streamId: number
  readonly request: {
    readonly url: string
    readonly method: string
    readonly headers: readonly [string, string][]
  }
}

/** Commands accepted by the desktop child process. */
export type DesktopHostCommand = {
  readonly type: 'shutdown'
}

/** Events emitted by the desktop child process. */
export type DesktopHostEvent = {
  readonly type: 'ready'
  readonly protocolVersion: typeof DESKTOP_HOST_PROTOCOL_VERSION
  readonly dshVersion: string
} | {
  readonly type: 'fatal'
  readonly errorType: 'AggregateError' | 'Error' | 'RangeError' | 'SyntaxError' | 'TypeError' | 'UnknownError' | 'ValidationError'
  readonly path?: readonly (string | number)[]
  readonly rule?: string
}

type DesktopHostFailure = Extract<DesktopHostEvent, { type: 'fatal' }>

const errorTypes = new Set<DesktopHostFailure['errorType']>([
  'AggregateError', 'Error', 'RangeError', 'SyntaxError', 'TypeError', 'ValidationError',
])
const COMPATIBILITY_HOST_PACKAGE = '@deepseek-ai/dsh-desktop-host-compatibility'

async function createCompatibilityRuntime(
  runtimeDir: string, projectDir: string, allowLinkedPackages: boolean,
): Promise<DesktopHostRuntime> {
  const require = createRequire(join(projectDir, 'package.json'))
  let entry: string
  try {
    entry = require.resolve(COMPATIBILITY_HOST_PACKAGE)
  } catch (error) {
    throw new Error('dsh desktop: legacy bundles require the separately installed Desktop compatibility Host; profile files were preserved', { cause: error })
  }
  const compatibility = await import(pathToFileURL(entry).href) as typeof import('@deepseek-ai/dsh-desktop-host-compatibility')
  return compatibility.createLegacyDesktopRuntime(runtimeDir, projectDir, allowLinkedPackages)
}

function failureEvent(error: unknown): DesktopHostFailure {
  const errors = errorChain(error)
  // Only producer-sanitized issues carry a rule; raw validator issues may name user dictionary keys.
  const issueOf = (candidate: Error): unknown => {
    const issues = (candidate as Error & { issues?: unknown }).issues
    const issue: unknown = Array.isArray(issues) ? (issues as unknown[])[0] : undefined
    return typeof issue === 'object' && issue !== null && 'rule' in issue && typeof issue.rule === 'string' ? issue : undefined
  }
  const source = errors.find(candidate => issueOf(candidate) !== undefined) ?? errors[0]
  const issue = source === undefined ? undefined : issueOf(source)
  const path: (string | number)[] | undefined = typeof issue === 'object' && issue !== null && 'path' in issue && Array.isArray(issue.path)
    ? (issue.path as unknown[]).filter((part: unknown): part is string | number => typeof part === 'string' || typeof part === 'number')
    : undefined
  const rule = typeof issue === 'object' && issue !== null && 'rule' in issue && typeof issue.rule === 'string'
    ? issue.rule
    : undefined
  return {
    type: 'fatal',
    errorType: source === undefined ? 'Error'
      : errorTypes.has(source.name as DesktopHostFailure['errorType']) ? source.name as DesktopHostFailure['errorType'] : 'Error',
    ...path === undefined ? {} : { path },
    ...rule === undefined ? {} : { rule },
  }
}

function errorChain(error: unknown): Error[] {
  const pending = [error]
  const seen = new Set<Error>()
  const errors: Error[] = []
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const value = pending[cursor]
    if (!(value instanceof Error) || seen.has(value)) continue
    seen.add(value)
    errors.push(value)
    if ('cause' in value) pending.push(value.cause)
    if (value instanceof AggregateError) {
      for (const nested of value.errors as unknown[]) pending.push(nested)
    }
  }
  return errors
}

/** Controller returned to tests and the self-executing process entry. */
export interface DesktopHostController {
  /** Installed dsh version carried by this host. */
  readonly dshVersion: string
  /** Dispatch one custom-protocol request and stream its response to the response pipe. */
  fetch(command: DesktopHostFetchCommand, body: ReadableStream<Uint8Array> | null): Promise<void>
  /** Abort one in-flight request. */
  cancel(streamId: number): void
  /** Stop accepting messages and await complete host teardown. */
  dispose(): Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isDesktopHostCommand(message: unknown): message is DesktopHostCommand {
  return typeof message === 'object' && message !== null && 'type' in message
    && (message as Record<string, unknown>).type === 'shutdown'
}

function dshVersion(runtimeDir: string): string {
  const value: unknown = JSON.parse(readFileSync(join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'))
  if (!isRecord(value) || typeof value.version !== 'string') throw new Error('dsh desktop: installed dsh manifest has no version')
  return value.version
}

interface NodeRequestInit extends RequestInit {
  readonly duplex?: 'half'
}

/**
 * Boot one installed desktop npm project.
 * @param runtimeDir - immutable dsh packages supplied by the Electron application.
 * @param projectDir - active or staged Electron-owned desktop profile.
 * @param writeResponse - serialized response-pipe writer that applies byte backpressure.
 * @param options - development-only allowance for workspace-linked bundle packages.
 * @returns controller after every Host and client-manifest row is active.
 */
export async function runDesktopHost(
  runtimeDir: string,
  projectDir: string,
  writeResponse: (frame: Buffer) => Promise<void>,
  options: { allowLinkedPackages?: boolean } = {},
): Promise<DesktopHostController> {
  const absoluteProject = resolve(projectDir)
  mkdirSync(absoluteProject, { recursive: true })
  const absoluteRuntime = resolve(runtimeDir)
  const version = dshVersion(absoluteRuntime)
  const allowLinkedPackages = options.allowLinkedPackages === true
  const runtime = profileDirectoryRuntime(absoluteProject) === 'native'
    ? await import('./native-host.ts').then(module => module.createNativeDesktopRuntime(absoluteRuntime, absoluteProject, allowLinkedPackages))
    : await createCompatibilityRuntime(absoluteRuntime, absoluteProject, allowLinkedPackages)
  const requests = new Map<number, AbortController>()
  let disposing: Promise<void> | undefined

  const dispose = async (): Promise<void> => {
    disposing ??= (async () => {
      for (const controller of requests.values()) controller.abort()
      requests.clear()
      await runtime.dispose()
    })()
    await disposing
  }

  return {
    dshVersion: version,
    cancel(streamId) {
      requests.get(streamId)?.abort()
    },
    async fetch(command, body) {
      if (disposing !== undefined) throw new Error('dsh desktop: host is disposing')
      const controller = new AbortController()
      requests.set(command.streamId, controller)
      try {
        const url = new URL(command.request.url)
        const init: NodeRequestInit = {
          method: command.request.method,
          headers: new Headers(command.request.headers.map(([name, value]) => [name, value] as [string, string])),
          ...(body === null ? {} : { body, duplex: 'half' }),
          signal: controller.signal,
        }
        const request = new Request(url, init)
        const response = await runtime.fetch(request)
        await writeResponse(encodeDesktopResponseStart(command.streamId, {
          status: response.status,
          headers: [...response.headers.entries()],
          hasBody: response.body !== null,
        }))
        if (response.body !== null) {
          for await (const chunk of response.body) {
            const bytes = Buffer.from(chunk)
            for (let offset = 0; offset < bytes.byteLength; offset += DESKTOP_PIPE_CHUNK_BYTES) {
              await writeResponse(encodeDesktopResponseData(
                command.streamId,
                bytes.subarray(offset, offset + DESKTOP_PIPE_CHUNK_BYTES),
              ))
            }
          }
        }
        await writeResponse(encodeDesktopResponseEnd(command.streamId))
      } catch (error) {
        if (!controller.signal.aborted) {
          await writeResponse(encodeDesktopResponseError(
            command.streamId,
            error instanceof Error ? error.message : String(error),
          ))
        }
      } finally {
        requests.delete(command.streamId)
      }
    },
    dispose,
  }
}

async function main(): Promise<void> {
  const runtimeDir = process.argv[2]
  const projectDir = process.argv[3]
  if (runtimeDir === undefined || projectDir === undefined || process.send === undefined) {
    throw new Error('dsh desktop: expected runtime and profile directories, byte pipes, and a Node IPC channel')
  }
  const option = process.argv[4]
  if (option !== undefined && option !== '--allow-linked-profile') {
    throw new Error(`dsh desktop: unsupported internal option ${JSON.stringify(option)}`)
  }
  const pipes = openDesktopHostPipes()
  const requestPipe = pipes.requests
  const responsePipe = pipes.responses
  let responseWriteTail: Promise<void> = Promise.resolve()
  const writeResponse = (frame: Buffer): Promise<void> => {
    const write = responseWriteTail.then(async () => {
      if (responsePipe.destroyed) throw new Error('dsh desktop: Electron response pipe is unavailable')
      if (!responsePipe.write(frame)) await once(responsePipe, 'drain')
    })
    responseWriteTail = write.catch(() => undefined)
    return write
  }
  const send = (event: DesktopHostEvent): void => {
    if (process.send === undefined || !process.connected) return
    try {
      process.send(event)
    } catch (error) {
      // A concurrent parent disconnect owns teardown; only that closed-channel
      // condition is safe to discard while streamed responses unwind.
      if ((error as NodeJS.ErrnoException).code !== 'ERR_IPC_CHANNEL_CLOSED') throw error
    }
  }
  const controller = await runDesktopHost(runtimeDir, projectDir, writeResponse, { allowLinkedPackages: option !== undefined })
  send({
    type: 'ready',
    protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    dshVersion: controller.dshVersion,
  })
  const decoder = new DesktopHostRequestDecoder()
  const requestBodies = new Map<number, ReadableStreamDefaultController<Uint8Array>>()
  const blockedRequests = new Set<number>()
  const discardedRequestBodies = new Set<number>()
  const runs = new Set<Promise<void>>()
  let lastStreamId = 0
  let requestedExitCode = 0
  let stopping: Promise<void> | undefined

  const resumeRequestPipe = (): void => {
    if (blockedRequests.size === 0) requestPipe.resume()
  }

  const stop = (exitCode = 0): Promise<void> => {
    requestedExitCode = Math.max(requestedExitCode, exitCode)
    stopping ??= (async () => {
      requestPipe.pause()
      requestPipe.removeAllListeners('data')
      const stopped = new Error('dsh desktop: Host is stopping')
      for (const body of requestBodies.values()) body.error(stopped)
      requestBodies.clear()
      blockedRequests.clear()
      discardedRequestBodies.clear()
      // Closing the request end stops further reads; the pipe owns descriptor 3.
      requestPipe.destroy()
      await controller.dispose()
      await Promise.allSettled([...runs])
      await responseWriteTail.catch(() => undefined)
      await pipes.close()
      if (process.connected) process.disconnect()
      process.exitCode = requestedExitCode
    })()
    return stopping
  }

  const failTransport = (error: unknown): void => {
    console.error('Desktop Host transport failed', error)
    send(failureEvent(error))
    void stop(1)
  }

  const beginRequest = (frame: Extract<DesktopHostRequestFrame, { type: 'start' }>): void => {
    if (frame.streamId <= lastStreamId) {
      throw new Error(`dsh desktop: Electron reused or reordered request stream ${String(frame.streamId)}`)
    }
    lastStreamId = frame.streamId
    let body: ReadableStream<Uint8Array> | null = null
    if (frame.hasBody) {
      body = new ReadableStream<Uint8Array>({
        start(controllerOfBody) {
          requestBodies.set(frame.streamId, controllerOfBody)
        },
        pull() {
          blockedRequests.delete(frame.streamId)
          resumeRequestPipe()
        },
        cancel() {
          requestBodies.delete(frame.streamId)
          blockedRequests.delete(frame.streamId)
          controller.cancel(frame.streamId)
          resumeRequestPipe()
        },
      })
    }
    const run = controller.fetch({
      streamId: frame.streamId,
      request: {
        url: frame.url,
        method: frame.method,
        headers: frame.headers,
      },
    }, body)
    runs.add(run)
    void run.catch(failTransport).finally(() => {
      runs.delete(run)
      const openBody = requestBodies.get(frame.streamId)
      if (openBody === undefined) return
      openBody.error(new Error('dsh desktop: response completed before the request body ended'))
      requestBodies.delete(frame.streamId)
      blockedRequests.delete(frame.streamId)
      discardedRequestBodies.add(frame.streamId)
      resumeRequestPipe()
    })
  }

  const handleRequestFrame = (frame: DesktopHostRequestFrame): void => {
    switch (frame.type) {
      case 'start':
        beginRequest(frame)
        return
      case 'data': {
        const body = requestBodies.get(frame.streamId)
        if (body === undefined) {
          if (discardedRequestBodies.has(frame.streamId)) return
          throw new Error(`dsh desktop: Electron sent body data for inactive stream ${String(frame.streamId)}`)
        }
        body.enqueue(frame.data)
        if ((body.desiredSize ?? 0) <= 0) {
          blockedRequests.add(frame.streamId)
          requestPipe.pause()
        }
        return
      }
      case 'end': {
        const body = requestBodies.get(frame.streamId)
        if (body === undefined) {
          if (discardedRequestBodies.delete(frame.streamId)) return
          throw new Error(`dsh desktop: Electron ended inactive body stream ${String(frame.streamId)}`)
        }
        body.close()
        requestBodies.delete(frame.streamId)
        blockedRequests.delete(frame.streamId)
        resumeRequestPipe()
        return
      }
      case 'cancel': {
        if (frame.streamId > lastStreamId) {
          throw new Error(`dsh desktop: Electron canceled unknown stream ${String(frame.streamId)}`)
        }
        const body = requestBodies.get(frame.streamId)
        body?.error(new Error('dsh desktop: Electron canceled the request'))
        requestBodies.delete(frame.streamId)
        blockedRequests.delete(frame.streamId)
        discardedRequestBodies.delete(frame.streamId)
        controller.cancel(frame.streamId)
        resumeRequestPipe()
        return
      }
      default:
        frame satisfies never
    }
  }

  requestPipe.on('data', (chunk: string | Buffer) => {
    try {
      for (const frame of decoder.push(Buffer.from(chunk))) handleRequestFrame(frame)
    } catch (error) {
      failTransport(error)
    }
  })
  requestPipe.once('end', () => {
    if (stopping !== undefined) return
    try {
      decoder.finish()
      failTransport(new Error('dsh desktop: Electron request pipe ended'))
    } catch (error) {
      failTransport(error)
    }
  })
  requestPipe.once('error', failTransport)
  responsePipe.once('error', failTransport)
  process.on('message', (message: unknown) => {
    if (!isDesktopHostCommand(message)) {
      send({ type: 'fatal', errorType: 'Error' })
      void stop(1)
      return
    }
    void stop()
  })
  process.once('disconnect', () => { void stop() })
  process.once('SIGTERM', () => { void stop() })
  process.once('SIGINT', () => { void stop() })
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Desktop Host startup failed', error)
    if (process.send !== undefined) process.send(failureEvent(error))
    else process.stderr.write(`dsh desktop: ${message}\n`)
    process.exitCode = 1
  })
}

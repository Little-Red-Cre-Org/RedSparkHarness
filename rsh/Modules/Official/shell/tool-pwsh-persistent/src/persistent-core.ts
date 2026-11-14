/* jscpd:ignore-start */
// Deliberate mirror of tool-bash-persistent (persistent-pty note 2026-08-11-pwsh-persistent-pty):
// the PowerShell counterpart shares the session registry, polling loop, and reset contract by design.
/**
 * Runtime-neutral persistent PowerShell extraction, owner reuse and reset.
 * Cordis and Native adapters supply the terminal port; this module imports neither.
 * @module @redspark/rsh-tool-pwsh-persistent/persistent-core
 */

import { randomUUID } from 'node:crypto'
import type { TerminalReadRequest, TerminalReadResult, TerminalSendOperation, TerminalSendRequest, TerminalSendResult } from '@redspark/rsh-terminal/protocol'
import { deadline, timeoutOf } from '@redspark/rsh-timeout'

// TODO: Replace the file-search advice; arbitrary command output need not come from a searchable file.
const TRUNCATED_MESSAGE = '<response clipped><NOTE>To save on context only part of this file has been shown to you. You should retry this tool after you have searched inside the file with Select-String in order to find the line numbers of what you are looking for.</NOTE>'
const LOST_PREFIX_MESSAGE = '<response clipped><NOTE>The beginning of this command output was dropped by the terminal scrollback limit. The following text is the earliest retained output.</NOTE>\n'
const SHELL_RESET_MESSAGE = 'The persistent pwsh shell was reset; the next pwsh call starts from the workspace with a fresh current directory and environment.'
const SHELL_PROMPT = '__RSH_PERSISTENT_PWSH_PROMPT__ '
const TIMEOUT_CODE = 'PERSISTENT_PWSH_TIMEOUT'
// One page is enough to find a just-emitted completion marker; the full
// scrollback is assembled only when a command settles or needs partial output.
const SCROLLBACK_PAGE_LINES = 1_000
const POLL_INTERVAL_MS = 25
/** Default model-facing description when a deployment does not set one. */
export const DEFAULT_DESCRIPTION = 'Run commands in a persistent PowerShell shell. State, including the current directory and exported environment variables, persists across calls for this agent.'

/** Selected persistent PowerShell tool configuration. */
export interface ResolvedPersistentPwshConfig {
  /** PTY backend type used for each owner-isolated shell. */
  backendType: string
  /** Wall-clock limit for one command, in milliseconds. */
  timeoutMs: number
  /** Maximum returned command-output characters before clipping. */
  maxOutputChars: number
  /** Model-facing tool description. */
  description: string
}

/** Untrusted configuration object before validation. */
export interface PersistentPwshConfigInput {
  /** PTY backend type. */
  backendType?: string
  /** Wall-clock limit for one command, in milliseconds. */
  timeoutMs?: number
  /** Maximum returned command-output characters before clipping. */
  maxOutputChars?: number
  /** Model-facing tool description. */
  description?: string
}

interface CommandMarkers {
  start: string
  end: string
}

interface RetainedOutput {
  text: string
  truncated: boolean
}

interface CapturedOutput {
  text: string
  incomplete: boolean
  exitCode?: number
}

/** Top-level terminal state visible to the command loop. */
export interface PersistentTerminalStatus {
  /** Running, or a terminal that must be reset before the next command. */
  readonly kind: 'running' | 'exited'
  /** Exit code when the port observed one; Native list snapshots omit it. */
  readonly exitCode: number | null
  /** Killing signal when the port observed one; Native list snapshots omit it. */
  readonly signal: NodeJS.Signals | null
}

/**
 * Terminal operations the persistent shell needs from either runtime.
 * @typeParam Owner - the agent identity that owns the shell.
 * @typeParam Id - the runtime's terminal session identity.
 */
export interface PersistentTerminalPorts<Owner extends object, Id> {
  /**
   * Current status of one owned session, or undefined when the runtime has dropped it.
   * @param owner - the agent that owns the session.
   * @param id - the session to inspect.
   * @returns the observed status.
   */
  status(owner: Owner, id: Id): PersistentTerminalStatus | undefined
  /**
   * Close one owned session. A missing session is a no-op.
   * @param owner - the agent that owns the session.
   * @param id - the session to close.
   * @param reason - diagnostic retained by runtimes that accept one.
   */
  close(owner: Owner, id: Id, reason: string): Promise<void>
  /**
   * Start one exclusive send.
   * @param owner - the agent that owns the session.
   * @param id - the session to write.
   * @param request - input, Enter selection and cancellation.
   * @returns the live operation.
   */
  startSend(owner: Owner, id: Id, request: TerminalSendRequest): TerminalSendOperation
  /**
   * Read one scrollback page.
   * @param owner - the agent that owns the session.
   * @param id - the session to read.
   * @param request - newest-relative page selection.
   * @returns the bounded page.
   */
  read(owner: Owner, id: Id, request: TerminalReadRequest): TerminalReadResult
  /**
   * Register plugin-disposal cleanup.
   * @param cleanup - close every live shell.
   */
  onDispose(cleanup: () => Promise<void>): void
  /**
   * Register owner-disposal cache cleanup.
   * @param owner - the agent whose cache entry should be dropped.
   * @param cleanup - drop that owner's pending and live entries.
   */
  onOwnerDispose(owner: Owner, cleanup: () => void): void
}

/** One command invocation's terminal allocation. */
export interface PersistentPwshSpawn<Id> {
  /**
   * Allocate the owner's shell.
   * @param signal - cancellation for allocation and initialization.
   * @returns the new session identity.
   */
  (signal: AbortSignal): Promise<Id>
}

interface PersistentShells<Owner extends object, Id> {
  get(owner: Owner, signal: AbortSignal, spawn: PersistentPwshSpawn<Id>): Promise<Id>
  reset(owner: Owner, reason: string): Promise<void>
}

function maybeTruncate(content: string, maxOutputChars: number, incomplete = false): string {
  if (content.length <= maxOutputChars && !incomplete) return content
  return content.length <= maxOutputChars
    ? content + TRUNCATED_MESSAGE
    : content.slice(0, maxOutputChars) + TRUNCATED_MESSAGE
}

function markers(): CommandMarkers {
  const nonce = randomUUID()
  return {
    start: `__RSH_PERSISTENT_PWSH_START_${nonce}__`,
    end: `__RSH_PERSISTENT_PWSH_END_${nonce}:`,
  }
}

/**
 * Escape a command body for embedding in the wrapper's double-quoted string.
 * Backtick escapes keep every character literal: backtick first so the
 * escapes this function inserts are never re-escaped, `$` so no expansion
 * happens at wrapper construction, and `\r\n`/ESC so multi-line commands and
 * raw control bytes ride one physical input line without PSReadLine mangling.
 * @param value - the model's PowerShell command text.
 * @returns the escaped double-quoted-string body.
 */
function quoteForPwsh(value: string): string {
  return value
    .replaceAll('`', '``')
    .replaceAll('"', '`"')
    .replaceAll('$', '`$')
    .replaceAll('\r', '')
    .replaceAll('\n', '`n')
    .replaceAll('\x1b', '`e')
}

function wrapCommand(command: string, marker: CommandMarkers): string {
  // Keep the wrapper on one physical line: PSReadLine renders the echoed
  // input, and a wrapped line would split the echo the extraction strips.
  // The echoed END nonce can never fabricate completion because the status
  // regex needs digits immediately after it and the echo continues with
  // quote characters.
  const body = quoteForPwsh(command)
  return `Write-Output '${marker.start}'; $LASTEXITCODE = $null; $__s = 1; try { Invoke-Expression "${body}"; $__ok = $? } catch { $__ok = $false }; if ($null -ne $LASTEXITCODE) { $__s = [int]$LASTEXITCODE } else { $__s = if ($__ok) { 0 } else { 1 } }; Write-Output ('${marker.end}' + $__s)`
}

function stripPrompt(text: string): string {
  let result = text.replace(/\r?\n$/, '')
  while (result.endsWith(SHELL_PROMPT)) {
    result = result.slice(0, -SHELL_PROMPT.length)
  }
  return result.endsWith('\n') ? result.slice(0, -1) : result
}

function commandOutput(
  snapshot: RetainedOutput,
  marker: CommandMarkers,
  wrapper: string,
): CapturedOutput | undefined {
  const text = snapshot.text
  const end = text.lastIndexOf(marker.end)
  const status = /^(\d+)\r?\n/.exec(text.slice(end + marker.end.length))?.[1]
  if (status === undefined) return undefined
  const startMarker = text.lastIndexOf(marker.start, end)
  const start = startMarker < 0 ? 0 : startMarker + marker.start.length
  let captured = text.slice(start, end)
  // The PSReadLine echo carries the wrapper source (including both marker
  // nonces) before the real markers; anchor on the real markers excludes it,
  // and stripping the wrapper covers the rare case where the real START
  // scrolled out and extraction fell back to the echoed copy.
  captured = captured.replaceAll(wrapper, '')
  return {
    text: captured.replace(/^\r?\n/, '').replace(/\r?\n$/, ''),
    incomplete: startMarker < 0,
    exitCode: Number(status),
  }
}

function promptCompleted(result: TerminalSendResult): boolean {
  return result.viewport.endsWith(SHELL_PROMPT)
    || result.viewport.endsWith(`${SHELL_PROMPT}\r\n`)
    || result.viewport.endsWith(`${SHELL_PROMPT}\n`)
}

function partialOutput(
  snapshot: RetainedOutput,
  marker: CommandMarkers,
  wrapper: string,
  fallback: string,
  fallbackTruncated = false,
): CapturedOutput {
  const startMarker = snapshot.text.lastIndexOf(marker.start)
  if (startMarker >= 0) {
    return {
      text: stripPrompt(snapshot.text.slice(startMarker + marker.start.length).replace(/^\r?\n/, '')),
      incomplete: false,
    }
  }
  const fallbackStart = fallback.lastIndexOf(marker.start)
  const afterStart = fallbackStart < 0
    ? fallback
    : fallback.slice(fallbackStart + marker.start.length).replace(/^\r?\n/, '')
  const fallbackEnd = afterStart.lastIndexOf(marker.end)
  const beforeEnd = fallbackEnd < 0 ? afterStart : afterStart.slice(0, fallbackEnd)
  return {
    text: stripPrompt(beforeEnd.replaceAll(SHELL_PROMPT, '').replaceAll(wrapper, '')),
    incomplete: fallbackTruncated || fallbackStart < 0,
  }
}

async function pause(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
}

function nextScrollbackOffset(page: TerminalReadResult, offset: number): number | undefined {
  if (page.text.length === 0 || page.lineEnd <= offset) return undefined
  return page.lineEnd
}

function retainedScrollback<Owner extends object, Id>(
  ports: PersistentTerminalPorts<Owner, Id>,
  owner: Owner,
  id: Id,
  latest = ports.read(owner, id, { offset: 0, count: SCROLLBACK_PAGE_LINES }),
): RetainedOutput {
  const pages: string[] = latest.text.length === 0 ? [] : [latest.text]
  let offset = latest.lineEnd
  let truncated = latest.truncated
  while (true) {
    if (offset >= latest.totalLines) break
    const page = ports.read(owner, id, { offset, count: SCROLLBACK_PAGE_LINES })
    truncated ||= page.truncated
    if (page.text.length > 0) pages.unshift(page.text)
    const next = nextScrollbackOffset(page, offset)
    if (next === undefined || next >= page.totalLines) break
    offset = next
  }
  return { text: pages.join('\n'), truncated }
}

function renderCaptured(output: CapturedOutput, maxOutputChars: number): string {
  const rendered = maybeTruncate(output.text, maxOutputChars, output.incomplete)
  const withPrefix = output.incomplete && output.text.length > 0
    ? LOST_PREFIX_MESSAGE + rendered
    : rendered
  const marker = output.exitCode !== undefined && output.exitCode !== 0
    ? `[exit code: ${output.exitCode}]`
    : undefined
  return appendStatusMarker(withPrefix, marker)
}

function appendStatusMarker(content: string, marker: string | undefined): string {
  if (marker === undefined) return content
  return content.length === 0 ? marker : `${content}\n${marker}`
}

function renderShellExitStatus(
  content: string,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
): string {
  const marker = signal !== null
    ? `[shell killed by signal: ${signal}]`
    : exitCode !== null
      ? `[shell exited: code ${exitCode}]`
      : '[shell exited]'
  return appendStatusMarker(content, marker)
}

/**
 * Render the exited-session result, reset the owner's shell, and append the
 * message that tells the model the next call starts fresh.
 * @param ports - the terminal operations used to read retained output.
 * @param shells - the owner-scoped registry to reset.
 * @param status - the exited session status (exit code and signal).
 * @returns the complete model-facing result.
 */
async function respondToSessionExit<Owner extends object, Id>(
  ports: PersistentTerminalPorts<Owner, Id>,
  shells: PersistentShells<Owner, Id>,
  owner: Owner,
  id: Id,
  status: { exitCode: number | null; signal: NodeJS.Signals | null },
  marker: CommandMarkers,
  wrapped: string,
  fallback: string,
  fallbackTruncated: boolean,
  config: ResolvedPersistentPwshConfig,
): Promise<string> {
  const snapshot = retainedScrollback(ports, owner, id)
  await shells.reset(owner, 'persistent pwsh shell exited')
  return [
    renderShellExitStatus(
      renderCaptured(partialOutput(snapshot, marker, wrapped, fallback, fallbackTruncated), config.maxOutputChars),
      status.exitCode,
      status.signal,
    ),
    SHELL_RESET_MESSAGE,
  ].filter(part => part.length > 0).join('\n')
}

/**
 * The pwsh prompt function that overrides the backend bootstrap value with
 * this tool's own prompt. `[char]27`/`[char]7` build the OSC bytes at runtime
 * because raw ESC characters in submitted input are unreliable under
 * PSReadLine.
 */
const PWSH_PROMPT_SETUP =
  "function prompt { [Console]::Write([char]27 + ']133;D;' + [int]$LASTEXITCODE + [char]7); '" + SHELL_PROMPT + "' }"

function persistentShells<Owner extends object, Id>(
  ports: PersistentTerminalPorts<Owner, Id>,
): PersistentShells<Owner, Id> {
  const pending = new WeakMap<Owner, Promise<Id>>()
  const live = new Map<Owner, Id>()
  const creating = new Set<Promise<Id>>()
  const ownerCleanupInstalled = new WeakSet<Owner>()
  const lifecycle = new AbortController()

  const close = async (owner: Owner, id: Id, reason: string): Promise<void> => {
    await ports.close(owner, id, reason)
  }

  ports.onDispose(async () => {
    lifecycle.abort(new Error('tool-pwsh-persistent disposed during shell creation'))
    await Promise.allSettled([...creating])
    const closing = [...live].map(async ([owner, id]) => { await close(owner, id, 'tool-pwsh-persistent disposed') })
    await Promise.all(closing)
    live.clear()
  })

  const reset = async (owner: Owner, reason: string): Promise<void> => {
    pending.delete(owner)
    const id = live.get(owner)
    live.delete(owner)
    if (id !== undefined) await close(owner, id, reason)
  }

  const get = (owner: Owner, signal: AbortSignal, spawn: PersistentPwshSpawn<Id>): Promise<Id> => {
    const existing = pending.get(owner)
    if (existing !== undefined) return existing
    const combinedSignal = AbortSignal.any([signal, lifecycle.signal])
    const creation = (async () => {
      try {
        const id = await spawn(combinedSignal)
        live.set(owner, id)
        if (!ownerCleanupInstalled.has(owner)) {
          ownerCleanupInstalled.add(owner)
          ports.onOwnerDispose(owner, () => {
            pending.delete(owner)
            live.delete(owner)
          })
        }
        const setup = ports.startSend(owner, id, {
          text: PWSH_PROMPT_SETUP,
          submit: true,
          signal: combinedSignal,
        })
        const result = await setup.done
        if (result.sessionStatus.kind === 'exited' || result.waitReason === 'timeout') {
          throw new Error('persistent pwsh shell did not accept initialization')
        }
        return id
      } catch (error: unknown) {
        await reset(owner, 'persistent pwsh initialization failed')
        throw error
      }
    })()
    const tracked = creation.finally(() => {
      creating.delete(tracked)
    })
    creating.add(tracked)
    pending.set(owner, tracked)
    return tracked
  }

  return { get, reset }
}

async function executeCommand<Owner extends object, Id>(
  ports: PersistentTerminalPorts<Owner, Id>,
  shells: PersistentShells<Owner, Id>,
  owner: Owner,
  command: string,
  config: ResolvedPersistentPwshConfig,
  upstream: AbortSignal,
  spawn: PersistentPwshSpawn<Id>,
): Promise<string> {
  using commandDeadline = deadline(upstream, config.timeoutMs, TIMEOUT_CODE)
  const id = await shells.get(owner, commandDeadline.signal, spawn)
  const marker = markers()
  const wrapped = wrapCommand(command, marker)
  let first = true
  let fallback = ''
  let fallbackTruncated = false

  while (true) {
    // The shell may flip to exited between iterations (a fast `exit` can
    // settle the previous send while its exit event is still in flight, and
    // the echoed wrapper can then carry a marker end without status digits);
    // re-observing status before the next send closes that gap.
    const status = ports.status(owner, id)
    if (status?.kind === 'exited') {
      return await respondToSessionExit(
        ports, shells, owner, id, status, marker, wrapped, fallback, fallbackTruncated, config,
      )
    }
    let operation: TerminalSendOperation
    let result: Awaited<TerminalSendOperation['done']>
    try {
      operation = ports.startSend(owner, id, {
        text: first ? wrapped : '',
        submit: first,
        signal: commandDeadline.signal,
      })
      first = false
      result = await operation.done
    } catch (error: unknown) {
      await shells.reset(owner, 'persistent pwsh send failed')
      throw error
    }
    const incremental = operation.readOutput()
    fallback = incremental.delta.length > 0 ? fallback + incremental.delta : result.viewport
    fallbackTruncated ||= incremental.truncated || result.truncated
    const latest = ports.read(owner, id, { offset: 0, count: SCROLLBACK_PAGE_LINES })
    const timedOut = timeoutOf(commandDeadline.signal, TIMEOUT_CODE)
    if (timedOut !== undefined) {
      const snapshot = retainedScrollback(ports, owner, id, latest)
      const partial = renderCaptured(
        partialOutput(snapshot, marker, wrapped, fallback, fallbackTruncated),
        config.maxOutputChars,
      )
      await shells.reset(owner, 'persistent pwsh command timed out')
      return [
        // TODO: Report a timeout only; this signal does not establish an OOM.
        `Your command timed out after ${Math.round(timedOut.timeoutMs / 1000)} seconds or experienced an OOM error. Below is partial output:`,
        partial,
        SHELL_RESET_MESSAGE,
      ].join('\n')
    }
    if (commandDeadline.signal.aborted) {
      await shells.reset(owner, 'persistent pwsh command aborted')
      commandDeadline.signal.throwIfAborted()
    }
    if (latest.text.includes(marker.end)) {
      const complete = commandOutput(retainedScrollback(ports, owner, id, latest), marker, wrapped)
      if (complete !== undefined) return renderCaptured(complete, config.maxOutputChars)
    }
    if (result.sessionStatus.kind === 'exited') {
      return await respondToSessionExit(
        ports, shells, owner, id, result.sessionStatus, marker, wrapped, fallback, fallbackTruncated, config,
      )
    }
    if (promptCompleted(result)) {
      const snapshot = retainedScrollback(ports, owner, id, latest)
      return renderCaptured(
        partialOutput(snapshot, marker, wrapped, fallback, fallbackTruncated),
        config.maxOutputChars,
      )
    }
    await pause()
  }
}

/** One owner-scoped persistent PowerShell runtime. */
export interface PersistentPwshRuntime<Owner extends object, Id> {
  /**
   * Run one command on the owner's shell, allocating it on first use.
   * @param owner - the agent that owns the shell.
   * @param command - the non-empty command text.
   * @param signal - cancellation for this command.
   * @param spawn - allocates a shell for this owner when none is live.
   * @returns the model-facing command result.
   */
  execute(owner: Owner, command: string, signal: AbortSignal, spawn: PersistentPwshSpawn<Id>): Promise<string>
}

/**
 * Create the owner-scoped persistent PowerShell runtime.
 * @param ports - terminal operations for the selected runtime.
 * @param config - resolved backend, deadline, output bound and description.
 * @returns the command runner.
 */
export function createPersistentPwshRuntime<Owner extends object, Id>(
  ports: PersistentTerminalPorts<Owner, Id>,
  config: ResolvedPersistentPwshConfig,
): PersistentPwshRuntime<Owner, Id> {
  const shells = persistentShells(ports)
  const queues = new WeakMap<Owner, Promise<void>>()
  const serialized = async <T>(owner: Owner, operation: () => Promise<T>): Promise<T> => {
    const prior = queues.get(owner) ?? Promise.resolve()
    const run = prior.then(operation, operation)
    const tail = run.then(() => undefined, () => undefined)
    queues.set(owner, tail)
    try {
      return await run
    } finally {
      if (queues.get(owner) === tail) queues.delete(owner)
    }
  }
  return {
    async execute(owner, command, signal, spawn) {
      if (command.trim().length === 0) throw new Error('command must be a non-empty string')
      return serialized(owner, async () => {
        signal.throwIfAborted()
        return executeCommand(ports, shells, owner, command, config, signal, spawn)
      })
    },
  }
}

/**
 * Resolve persistent PowerShell configuration, rejecting empty or non-positive values.
 * @param input - selected backend, deadline, output bound and description.
 * @param prefix - package name used in error messages.
 * @returns the resolved configuration.
 */
export function resolvePersistentPwshConfig(
  input: PersistentPwshConfigInput,
  prefix: string,
): ResolvedPersistentPwshConfig {
  const resolved: ResolvedPersistentPwshConfig = {
    backendType: input.backendType ?? 'shell',
    timeoutMs: input.timeoutMs ?? 300_000,
    maxOutputChars: input.maxOutputChars ?? 16_000,
    description: input.description ?? DEFAULT_DESCRIPTION,
  }
  if (resolved.backendType.trim().length === 0) {
    throw new Error(`${prefix}: backendType must be non-empty`)
  }
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs <= 0) {
    throw new Error(`${prefix}: timeoutMs must be a positive safe integer`)
  }
  if (!Number.isSafeInteger(resolved.maxOutputChars) || resolved.maxOutputChars <= 0) {
    throw new Error(`${prefix}: maxOutputChars must be a positive safe integer`)
  }
  if (resolved.description.trim().length === 0) {
    throw new Error(`${prefix}: description must be non-empty`)
  }
  return resolved
}
/* jscpd:ignore-end */

/** Turn-scoped delivered-file facts folded directly from a Session log. */
import { isAppendSurfaceEvent } from '@redspark/rsh-session/surface'
import type { PresentedFile } from '@redspark/rsh-tool-present/types'
import type { SessionEvent } from '@redspark/rsh-session/types'
import { isPresentedData, isPresentedFile } from './presented.ts'

/** A declared file with its authorized open coordinates. */
export interface PresentedPath extends PresentedFile {
  readonly seq: number
  readonly index: number
}

/** One Turn's delivered files, in durable event order. */
export interface TurnDeliverables {
  /** Turn identity carried by every contributing event. */
  readonly turn: number
  /** Successful mutation paths in first-seen order. */
  readonly produced: readonly string[]
  /** Declared files in declaration order. */
  readonly presented: readonly PresentedPath[]
}

/**
 * Extract the path from a supported first-party mutation call. Session
 * `tool/call` events are root calls; Code Dispatch children do not enter this
 * Definition independently.
 * @param name - wire tool name.
 * @param argsRaw - model-produced JSON arguments.
 * @returns the mutation path, or null when the call is not a supported mutation.
 */
export function mutationPath(name: string, argsRaw: string): string | null {
  let args: unknown
  try {
    args = JSON.parse(argsRaw) as unknown
  } catch {
    return null
  }
  if (!isRecord(args)) return null
  switch (name) {
    case 'write':
      return typeof args.content === 'string' ? pathValue(args.file_path) : null
    case 'edit':
      return validEditArgs(args) ? pathValue(args.file_path) : null
    case 'str_replace_editor':
      return editorMutationPath(args)
    default:
      return null
  }
}

/** Validate the fields that an `edit` execution requires. */
function validEditArgs(args: Readonly<Record<string, unknown>>): boolean {
  return typeof args.old_string === 'string'
    && args.old_string.length > 0
    && typeof args.new_string === 'string'
    && args.old_string !== args.new_string
    && (args.replace_all === undefined || typeof args.replace_all === 'boolean')
}

/** Extract a path only from a complete mutating editor command. */
function editorMutationPath(args: Readonly<Record<string, unknown>>): string | null {
  const path = pathValue(args.path)
  if (path === null) return null
  switch (args.command) {
    case 'create':
      return typeof args.file_text === 'string' ? path : null
    case 'str_replace':
      return typeof args.old_str === 'string'
        && args.old_str.length > 0
        && (args.new_str === undefined || typeof args.new_str === 'string')
        ? path
        : null
    case 'insert':
      return typeof args.insert_line === 'number'
        && Number.isInteger(args.insert_line)
        && args.insert_line >= 0
        && typeof args.new_str === 'string'
        ? path
        : null
    default:
      return null
  }
}

/** A non-blank path preserves the exact spelling supplied to the tool. */
function pathValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/** Narrow parsed JSON to an argument object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Fold delivered-file facts directly from one Session log.
 *
 * Native transcripts have no Conversation Location index, so they read the
 * same successful mutation calls and `deliverables/presented` records the
 * Cordis Definition reads. Turns appear in first-event order; each Turn keeps
 * its produced paths and declared files.
 * @param events - accepted Session events, including restored history.
 * @returns one entry per Turn with produced files, declared files, or both.
 */
export function foldDeliverables(events: readonly SessionEvent[]): readonly TurnDeliverables[] {
  const turns = new Map<number, { produced: string[]; calls: Map<string, string | null>; presented: PresentedPath[] }>()
  const stateFor = (turn: number) => {
    let state = turns.get(turn)
    if (state === undefined) {
      state = { produced: [], calls: new Map(), presented: [] }
      turns.set(turn, state)
    }
    return state
  }
  for (const event of events) {
    switch (event.type) {
      case 'tool/call': {
        stateFor(event.data.turn).calls.set(
          String(event.data.callId),
          mutationPath(event.data.name, event.data.arguments),
        )
        break
      }
      case 'deliverables/presented': {
        if (!isPresentedData(event.data)) break
        const state = stateFor(event.data.turn)
        for (let index = 0; index < event.data.files.length; index += 1) {
          const file = event.data.files[index]
          if (isPresentedFile(file)) state.presented.push({ ...file, seq: event.seq, index })
        }
        break
      }
      case 'tool/result': {
        if (!isAppendSurfaceEvent(event) || event.data.message.content[0].isError === true) break
        const state = stateFor(event.data.turn)
        const path = state.calls.get(String(event.data.message.source.callId))
        if (path !== null && path !== undefined && !state.produced.includes(path)) state.produced.push(path)
        break
      }
      default:
        // SessionEvent is merge-extensible; unrelated event types carry no delivery fact.
        break
    }
  }
  return [...turns].flatMap(([turn, state]) => state.produced.length + state.presented.length === 0
    ? []
    : [{ turn, produced: state.produced, presented: state.presented }])
}

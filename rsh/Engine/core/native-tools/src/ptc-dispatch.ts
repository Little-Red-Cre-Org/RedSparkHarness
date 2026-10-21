/** Native nested calls sharing scoped admission and the application's Session writer. */
import { createUserMessage, HarnessError, ToolCallId, type UserMessage } from '@deepseek-ai/dsh-llm/native'
import { deepFreeze, snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import type { NativeToolExecution, NativeToolRegistry, NativeToolResult } from './index.ts'
import { createOrderedDispatchLane, type OrderedDispatch } from './ordered-dispatch.ts'

/** One program's nested execution, cancellation and durable settlement. */
export interface NativePtcDispatch {
  /** Merged outer and program-end cancellation supplied to the runtime. */
  readonly signal: AbortSignal
  /** Ordered sourced contexts; read after close to include all admitted results. */
  readonly additionalContexts: readonly UserMessage[]
  /** Successful nested conclusion; an outer failure cannot forward it. */
  readonly concludesTurn: boolean
  /**
   * @param name - visible business tool.
   * @param args - lossless JSON arguments.
   * @returns the ordered tool outcome; close drains logging.
   */
  dispatch(name: string, args: unknown): Promise<NativeToolResult>
  /** Cancel queued and admitted calls and drain their results. @returns quiescence; rejects a Session append failure. */
  close(): Promise<void>
}

function failed(error: unknown): NativeToolResult {
  return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true,
    error: { name: error instanceof Error ? error.name : 'Error', code: error instanceof HarnessError ? error.code : 'UNKNOWN' } }
}

/**
 * Own one program's ordered nested calls without another Agent, registry or writer.
 * @param tools - selected scoped registry.
 * @param parent - outer invocation with the application-owned append and approval authority.
 * @param maxParallel - positive safe integer body limit selected by configuration.
 * @returns a run owner that must be closed after the program finishes, including failures.
 */
export function createNativePtcDispatch(
  tools: NativeToolRegistry, parent: NativeToolExecution, maxParallel: number,
): NativePtcDispatch {
  if (!Number.isSafeInteger(maxParallel) || maxParallel < 1) throw new Error('native PTC: maxParallel must be a positive safe integer')
  const controller = new AbortController()
  const signal = AbortSignal.any([parent.signal, controller.signal])
  const lane = createOrderedDispatchLane(signal, maxParallel)
  let count = 0
  let closed = false
  let fatal: { error: unknown } | undefined
  const contexts: UserMessage[] = []
  let concludesTurn = false
  const failPersistence = (error: unknown): void => {
    fatal ??= { error }
    controller.abort(error)
  }
  return {
    signal,
    get additionalContexts() { return deepFreeze(structuredClone(contexts)) },
    get concludesTurn() { return concludesTurn },
    dispatch(name, args) {
      if (closed || signal.aborted) return Promise.reject(new Error('native PTC run is closed', { cause: signal.reason }))
      if (name === 'run_code') return Promise.reject(new Error('native PTC cannot dispatch its run_code transport'))
      const normalized = snapshotJsonValue(args)
      if (normalized === undefined) return Promise.reject(new HarnessError('native PTC arguments must be lossless JSON', 'INVALID_ARGS'))
      const argumentsValue = deepFreeze(normalized)
      const id = ToolCallId(`${parent.callId}:ptc:${++count}`)
      const attribution = { rootCallId: parent.callId, parentCallId: parent.callId, subCallId: id, name, arguments: argumentsValue }
      const call: NativeToolExecution = {
        agent: parent.agent, session: parent.session, callId: id, name, arguments: argumentsValue,
        signal, parent, appendEvent: parent.appendEvent,
        ...parent.approvalAuthority === undefined ? {} : { approvalAuthority: parent.approvalAuthority },
      }
      const completion = Promise.withResolvers<NativeToolResult>()
      let result: NativeToolResult | undefined
      const entry: OrderedDispatch = {
        flight: Promise.resolve(), settled: false,
        classify: () => tools.executionMode(call),
        abandon() { completion.reject(new Error(`native PTC call ${id} was abandoned`, { cause: signal.reason })) },
        async start() {
          try { await parent.appendEvent('tool/ptc-dispatch-start', attribution) }
          catch (error: unknown) { failPersistence(error); result = failed(error); this.settled = true; return }
          try {
            const prepared = await tools.prepare(call)
            this.flight = (async () => {
              try { result = await prepared.execute() }
              catch (error: unknown) { result = failed(error) }
              finally { this.settled = true }
            })()
          } catch (error: unknown) { result = failed(error); this.settled = true }
        },
        async commit() {
          if (fatal !== undefined) { completion.reject(fatal.error); return }
          if (result === undefined) throw new Error('native PTC body settled without a result')
          if (!result.isError && result.content.some(block => block.type === 'image')) {
            contexts.push(createUserMessage({ content: structuredClone([...result.content]), source: { kind: 'plugin', plugin: 'tools-ptc' } }))
          }
          contexts.push(...tools.settlementContexts({
            agent: call.agent, session: call.session, callId: id, name, arguments: argumentsValue, result,
          }))
          contexts.push(...structuredClone(result.additionalContexts ?? []))
          if (!result.isError && result.concludesTurn === true) concludesTurn = true
          completion.resolve(result)
          try {
            const log = await tools.projectPtcDispatchLog(call, result)
            await parent.appendEvent('tool/ptc-dispatch', { ...attribution, isError: log.isError, content: [...log.content] })
            tools.acceptResult(call, result)
          } catch (error: unknown) { failPersistence(error); completion.reject(error) }
        },
      }
      void lane.enqueue(entry).catch((error: unknown) => { failPersistence(error); completion.reject(error) })
      return completion.promise
    },
    async close() {
      closed = true
      controller.abort(new Error('native PTC program finished'))
      await lane.drain()
      if (fatal !== undefined) throw fatal.error
    },
  }
}

import { appendFileSync } from 'node:fs'

function record(audit, entry) {
  appendFileSync(audit, `${entry}\n`)
}

function childIds(operations) {
  return [...new Set(operations.filter(event => event.kind === 'model-request').map(event => event.id))]
}

function recordedOperation(operations, ordinal) {
  const id = childIds(operations)[ordinal - 1]
  if (id === undefined) throw new Error(`ptc-external-cancel: canonical Session omitted child ${ordinal}`)
  return operations.filter(event => event.id === id)
}

function waitForAbort(signal) {
  return new Promise((_resolve, reject) => {
    const fail = () => reject(signal.reason ?? new Error('ptc-external-cancel: Responses operation aborted'))
    if (signal.aborted) fail()
    else signal.addEventListener('abort', fail, { once: true })
  })
}

function responseStream(value) {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify(value)))
      controller.close()
    },
  })
  return { status: 200, contentType: 'application/json', body }
}

export const plugin = {
  apiVersion: 1,
  name: 'native-ptc-cancel-model',
  targets: ['host'],
  requires: [],
  provides: ['model'],
  resolve: input => context => {
    let generation = 0
    let captures = 0
    const operations = input.operationScript
    const prepareCall = async (provider, model) => {
      generation += 1
      record(input.audit, `prepare:${generation}`)
      const stream = async function* (request) {
        if (input.rootScript !== undefined) {
          const entry = input.rootScript[generation - 1]
          if (entry?.kind !== 'chunks') throw new Error('ptc-external-cancel: canonical root stream is incomplete')
          for (const chunk of entry.chunks) yield chunk
          return
        }
        if (generation !== 1) throw new Error('ptc-external-cancel: record expected one root generation')
        if (!request.tools?.some(value => value.name === 'subagent')) {
          throw new Error('ptc-external-cancel: root request omitted the subagent tool')
        }
        const call = { type: 'tool-call', id: 'ptc-root-subagent', name: 'subagent', arguments: JSON.stringify({
          description: 'Run the nested delegated task, then report its result.',
          prompt: 'Use run_code to start a nested child that continues this task.',
        }) }
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'block-end', index: 0, block: call }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      }
      const nativeResponses = {
        async capture(request, signal) {
          signal.throwIfAborted()
          captures += 1
          const operation = captures
          const selected = operations === undefined ? undefined : recordedOperation(operations, operation)
          const failed = selected?.find(event => event.kind === 'model-failure')
          record(input.audit, `capture:${generation}:${operation}`)
          return {
            route: request.route,
            outputTokenLimit: 'supported',
            async projectRequest(body, operationSignal) {
              operationSignal.throwIfAborted()
              return body
            },
            async forward(_body, operationSignal) {
              record(input.audit, `forward-enter:${operation}`)
              if (operation === 2) {
                if (operations !== undefined && failed === undefined) {
                  throw new Error('ptc-external-cancel: canonical nested child omitted its cancellation failure')
                }
                if (input.signalMode === 'handler-only') {
                  queueMicrotask(() => process.emit('SIGTERM'))
                } else if (input.signalMode !== 'parent-os-signal') {
                  throw new Error('ptc-external-cancel: unknown signal mode')
                }
                await waitForAbort(operationSignal)
                throw new Error('ptc-external-cancel: nested Responses forward completed before cancellation')
              }
              if (operation !== 1) throw new Error(`ptc-external-cancel: unexpected Responses operation ${operation}`)
              const response = selected?.find(event => event.kind === 'model-response')
              if (operations !== undefined && response === undefined) {
                throw new Error('ptc-external-cancel: canonical outer child omitted its response')
              }
              const completed = response === undefined
                ? { type: 'response.completed', response: { id: 'ptc-external-run-code', output: [{
                  type: 'function_call', id: 'ptc-run-code-item', call_id: 'ptc-run-code-call', name: 'run_code',
                  arguments: JSON.stringify({
                    description: 'Start the nested external child',
                    code: "return await tools.subagent({ description: 'nested cancellation child', prompt: 'Continue the nested task.' })",
                  }),
                }] } }
                : JSON.parse(response.completed)
              return responseStream(completed.response)
            },
            async close() { record(input.audit, `transport-close:${operation}`) },
          }
        },
      }
      return { model: { provider, id: model, name: model }, stream, nativeResponses }
    }
    context.provide('model', { prepareCall, async *stream() {
      throw new Error('ptc-external-cancel: expected NativeModelExecution to use the prepared generation')
    } })
  },
}

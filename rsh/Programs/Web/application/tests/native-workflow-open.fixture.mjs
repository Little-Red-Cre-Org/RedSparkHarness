import { appendFileSync, existsSync } from 'node:fs'
const release = __RELEASE__
const status = __STATUS__
const childPrompt = __CHILD_PROMPT__
const args = __ARGS__
const note = (label) => { appendFileSync(status, label + String.fromCharCode(10)) }
export const plugin = {
  apiVersion: 1,
  name: 'workflow-open-fixture-model',
  targets: ['host'],
  requires: [],
  provides: ['model', 'modelDirectory'],
  resolve: () => context => {
    context.provide('modelDirectory', {
      providers: () => [{ id: 'mock', name: 'Fixture' }],
      resolve: async (provider, id) => ({ provider, id, name: id, inputModalities: ['text'] }),
      catalog: async defaults => ({
        default: defaults,
        routableProviders: ['mock'],
        failures: [],
        groups: [{ id: 'mock', name: 'Fixture', models: [{ id: 'fixture', name: 'Workflow open fixture' }] }],
      }),
    })
    context.provide('model', {
      async *stream(request) {
        const blocks = request.messages.flatMap(message => message.content ?? [])
        const hasResult = blocks.some(block => block.type === 'tool-result')
        const text = JSON.stringify(request.messages)
        note('request child=' + text.includes(childPrompt) + ' result=' + hasResult)
        if (text.includes(childPrompt) && !hasResult) {
          note('child-started')
          while (!existsSync(release)) {
            if (request.signal.aborted) return
            await new Promise(resolve => setTimeout(resolve, 40))
          }
          note('child-released')
          const answer = 'WF_CHILD_OK'
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text: answer }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } }
          yield { type: 'finish', reason: { kind: 'stop' } }
          return
        }
        if (hasResult) {
          note('parent-done')
          const done = 'WORKFLOW_DONE'
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text: done }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: done } }
          yield { type: 'finish', reason: { kind: 'stop' } }
          return
        }
        note('parent-tool')
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id: 'wf', name: 'workflow', argumentsDelta: args }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'wf', name: 'workflow', arguments: args } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      },
    })
  },
}

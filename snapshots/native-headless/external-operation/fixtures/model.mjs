export const plugin = {
  apiVersion: 1,
  name: 'native-external-operation-model',
  targets: ['host'],
  requires: [],
  provides: ['model'],
  resolve: input => context => {
    let step = 0
    context.provide('model', { async *stream(request) {
      if (input.script !== undefined) {
        const entry = input.script[step++]
        if (entry?.kind !== 'chunks') throw new Error('native external-operation model replay exhausted')
        for (const chunk of entry.chunks) yield chunk
        return
      }

      if (step++ === 0) {
        const call = { type: 'tool-call', id: 'root-subagent-call', name: 'subagent', arguments: JSON.stringify({
          description: 'Create one workspace file',
          prompt: 'Use the write tool to create created.txt with exactly "written by the external child\\n".',
        }) }
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'block-end', index: 0, block: call }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }

      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } })
  },
}

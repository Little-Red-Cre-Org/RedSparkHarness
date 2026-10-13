export const plugin = {
  apiVersion: 1,
  name: 'native-claude-parent-model',
  targets: ['host'],
  requires: [],
  optional: [],
  provides: ['model'],
  resolve: input => context => {
    let step = 0
    context.provide('model', { async *stream() {
      if (input.script !== undefined) {
        const entry = input.script[step++]
        if (entry?.kind !== 'chunks') throw new Error('Claude Code snapshot replay exhausted its model script')
        for (const chunk of entry.chunks) yield chunk
        return
      }

      if (step++ === 0) {
        const call = { type: 'tool-call', id: 'claude-parent-subagent-call', name: 'subagent', arguments: JSON.stringify({
          description: 'Ask Claude Code for one short answer',
          prompt: 'Return exactly: Claude Code fixture answer.',
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

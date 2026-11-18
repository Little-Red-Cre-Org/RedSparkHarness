export const plugin = {
  apiVersion: 1,
  name: 'native-agent-teams-model',
  targets: ['host'],
  requires: [],
  optional: [],
  provides: ['model'],
  resolve: input => context => {
    let step = 0
    context.provide('model', { async *stream() {
      if (input.script !== undefined) {
        const entry = input.script[step++]
        if (entry?.kind !== 'chunks') throw new Error('Agent Teams snapshot replay exhausted its model script')
        for (const chunk of entry.chunks) yield chunk
        return
      }

      const index = step++
      if (index === 0) {
        const call = { type: 'tool-call', id: 'team-task-create', name: 'team_task_create', arguments: JSON.stringify({
          subject: 'Snapshot task',
          description: 'Record the Native Team durable task path.',
          write_scopes: ['docs/'],
        }) }
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'block-end', index: 0, block: call }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }

      if (index === 1) {
        const call = { type: 'tool-call', id: 'team-task-list', name: 'team_task_list', arguments: '{}' }
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'block-end', index: 0, block: call }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }

      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'DONE' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } })
  },
}

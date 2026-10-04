/** Controlled model and real registry contributions for the authored tool-results scene. */
import { appendFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm/native'

export const plugin = {
  apiVersion: 1, name: 'native-fixture-model', targets: ['host'], requires: ['tools'], provides: ['model'],
  resolve(input) {
    if (!Array.isArray(input.script) || typeof input.audit !== 'string' || typeof input.sessionsRoot !== 'string') throw new Error('tool-results: invalid fixture configuration')
    const script = structuredClone(input.script)
    return context => {
      const tools = context.require('tools')
      const schema = name => ({ name, description: 'Recorded tool result fixture.', parameters: { type: 'object', properties: {}, additionalProperties: false } })
      context.effect(tools.registerProjectedTool({
        schema: schema('context'),
        output: { schema: { type: 'string' }, render: () => ({ content: [{ type: 'text', text: 'context result' }], isError: false, meta: { display: 'context' } }) },
        execute: async () => ({ value: 'context', additionalContexts: [createUserMessage({
          source: { kind: 'plugin', plugin: 'tool-results-fixture' }, content: [{ type: 'text', text: 'durable extra input' }],
        })] }),
      }, context.scope))
      context.effect(tools.registerProjectedTool({
        schema: schema('finish'), output: { schema: { type: 'string' }, render: () => ({ content: [{ type: 'text', text: 'finish result' }], isError: false }) },
        execute: async () => ({ value: 'finished', concludesTurn: true }),
      }, context.scope))
      context.effect(tools.registerValueTool({
        schema: schema('after'), output: { schema: { type: 'string' }, render: () => ({ content: [{ type: 'text', text: 'after result' }], isError: false }) },
        execute: async () => 'after',
      }, context.scope))
      context.effect(tools.onResult((call, result) => {
        const logs = readdirSync(input.sessionsRoot, { recursive: true }).filter(name => String(name).endsWith('session.v3.jsonl'))
        const rows = logs.map(name => readFileSync(join(input.sessionsRoot, String(name)), 'utf8').trim().split('\n').map(line => JSON.parse(line)))
        const accepted = rows.find(records => records[0].id === call.session.id)
          ?.some(event => event.type === 'tool/result' && event.data.message.source.callId === call.callId)
        if (!accepted) throw new Error('tool-results: result observer ran before durable acceptance')
        appendFileSync(input.audit, JSON.stringify({ kind: 'accepted', name: call.name, isError: result.isError, meta: result.meta }) + '\n')
      }, context.scope))
      let index = 0
      context.provide('model', { async *stream(request) {
        appendFileSync(input.audit, JSON.stringify({ kind: 'model', messages: request.messages, tools: request.tools }) + '\n')
        const entry = script[index++]
        if (entry?.kind !== 'chunks') throw new Error('tool-results: replay script exhausted')
        for (const chunk of entry.chunks) yield chunk
      } })
    }
  },
}

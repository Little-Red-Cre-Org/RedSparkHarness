import { expect, it } from 'vitest'
import type {
  NativeExternalJsonValue,
  NativeExternalSubagentModelOperations,
} from '@deepseek-ai/dsh-native-subagent/native'
import {
  createCodexDynamicToolCatalog,
  parseCodexResponsesToolCalls,
} from '../src/dynamic-tools.ts'

const limits = { jsonDepth: 8 }

function completed(output: readonly NativeExternalJsonValue[]): NativeExternalJsonValue {
  return {
    type: 'response.completed',
    response: { id: 'resp-1', status: 'completed', output },
  }
}

const tools: NativeExternalSubagentModelOperations['tools'] = {
  schemas: [{
    name: 'lookup',
    description: 'Look up one value.',
    parameters: {
      type: 'object',
      properties: { key: { type: 'string' }, optional: { type: 'string' } },
      required: ['key'],
    },
  }],
  programSchemas: [{
    name: 'programOnly',
    description: 'Available only to the program tool.',
    parameters: { type: 'object' },
    output: { type: 'string' },
  }],
  promptText: 'Captured program instructions and schemas.',
}

it('builds both flat catalogs from direct schemas and parses their completed calls', () => {
  const catalog = createCodexDynamicToolCatalog(tools)
  expect(catalog.appServerTools).toEqual([{
    type: 'function', name: 'lookup', description: 'Look up one value.', inputSchema: tools.schemas[0]?.parameters,
  }])
  expect(catalog.responsesTools).toEqual([{
    type: 'function', strict: false, name: 'lookup', description: 'Look up one value.',
    parameters: tools.schemas[0]?.parameters,
  }])
  expect(catalog.promptText).toBe(tools.promptText)
  expect(catalog.namespaceFor('lookup')).toBeNull()
  expect(catalog.namespaceFor('programOnly')).toBeUndefined()

  const calls = parseCodexResponsesToolCalls(completed([
    { type: 'message', role: 'assistant', content: [] },
    { type: 'function_call', call_id: 'call-1', name: 'lookup', arguments: '{"key":"value"}' },
  ]), catalog, limits)
  expect(calls).toEqual([{ callId: 'call-1', name: 'lookup', arguments: { key: 'value' } }])

  const programOnly = createCodexDynamicToolCatalog({ ...tools, schemas: [] })
  expect(programOnly.appServerTools).toEqual([])
  expect(programOnly.responsesTools).toEqual([])
  expect(programOnly.promptText).toBe(tools.promptText)
  expect(() => parseCodexResponsesToolCalls(completed([
    { type: 'function_call', call_id: 'call-2', name: 'programOnly', arguments: '{}' },
  ]), programOnly, limits)).toThrow(/captured catalog/)
})

it.each([
  {
    label: 'an uncaptured tool name',
    item: { type: 'function_call', call_id: 'call-1', name: 'other', arguments: '{}' },
    jsonDepth: 8,
  },
  {
    label: 'a non-null namespace',
    item: { type: 'function_call', call_id: 'call-1', name: 'lookup', namespace: 'tools', arguments: '{}' },
    jsonDepth: 8,
  },
  {
    label: 'arguments deeper than the gateway limit',
    item: { type: 'function_call', call_id: 'call-1', name: 'lookup', arguments: '{"a":{"b":{}}}' },
    jsonDepth: 2,
  },
])('rejects $label', ({ item, jsonDepth }) => {
  expect(() => parseCodexResponsesToolCalls(
    completed([item]),
    createCodexDynamicToolCatalog(tools),
    { jsonDepth },
  )).toThrow()
})

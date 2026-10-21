import { expect, it, vi } from 'vitest'
import type { NativeContext } from '@deepseek-ai/dsh-native-runtime'
import type { NativeValueToolContribution } from '@deepseek-ai/dsh-native-tools'
import type { NativeToolExecution } from '@deepseek-ai/dsh-native-tools'
import type { NativeSubagentOperations } from '@deepseek-ai/dsh-native-subagent'
import { plugin } from '../src/index.ts'

it('registers a separate read-only tool over the selected Provider and resolves default scope', async () => {
  let contribution: NativeValueToolContribution | undefined
  const list = vi.fn<NativeSubagentOperations['list']>().mockResolvedValue([])
  const tools = { registerValueTool: (value: NativeValueToolContribution) => {
    contribution = value
    return () => {}
  } }
  const subagents = { continuationTools: tools, list }
  const context = { scope: {}, require: (name: string) => name === 'tools' ? tools : subagents,
    effect: () => {} } as unknown as NativeContext
  await plugin.resolve({})(context)
  if (contribution === undefined) throw new Error('missing list_agents contribution')
  expect(contribution.schema.name).toBe('list_agents')
  const call = { agent: {}, session: {}, arguments: {}, signal: new AbortController().signal } as NativeToolExecution
  expect(await contribution.execute(call)).toEqual([])
  expect(list).toHaveBeenCalledWith({ agent: call.agent, session: call.session, scope: 'children' }, call.signal)
  expect(contribution.output.render(call, [])).toMatchObject({ content: [{ text: '[]' }] })
})

it('rejects a discovery registry different from the selected Provider registry', async () => {
  const context = { scope: {}, require: (name: string) => name === 'tools' ? {} : { continuationTools: {} },
    effect: () => {} } as unknown as NativeContext
  expect(() => plugin.resolve({})(context)).toThrow('same Tools registry')
})

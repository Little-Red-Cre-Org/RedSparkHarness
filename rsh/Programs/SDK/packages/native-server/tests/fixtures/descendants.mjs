/** Actual delegation and a separate Program sharing the same selected Providers. */
import { NativeScope } from '@deepseek-ai/dsh-native-runtime'
import { createNativeHeadlessApplication, resolveNativeHeadlessConfig } from '@deepseek-ai/dsh-native-headless/native'
import { createUserMessage } from '@deepseek-ai/dsh-llm/native'
import { SessionId } from '@deepseek-ai/dsh-session/native'

export const plugin = {
  apiVersion: 1, name: 'sdk-descendant-fixture', targets: ['host'],
  requires: ['sessionExecution', 'activeSessions', 'fs', 'sessionPersistence', 'model', 'modelExecution', 'agents'],
  optional: ['tools', 'promptSections', 'sandboxPolicy', 'approval', 'codeRuntime', 'timeContext', 'agentPresets', 'workspaceRegistry', 'agentInstructions', 'modelSelection'],
  provides: [],
  resolve: () => (context) => {
    const execution = context.require('sessionExecution')
    let foreign
    const tools = context.optional('tools')
    if (!tools) throw new Error('sdk descendant fixture requires native tools')
    context.own(tools.register({
      schema: { name: 'fixture_delegate_child', description: 'Delegate the fixture task.',
        parameters: { type: 'object', properties: {}, additionalProperties: false } },
      execute: async (call) => {
        const config = execution.configuration(call.agent, call.session)
        if (call.session.id !== 'sdk-foreign-root') {
          foreign ??= createNativeHeadlessApplication(context, resolveNativeHeadlessConfig(config), new NativeScope(context.scope),
            { execution, active: context.require('activeSessions') })
          await foreign.executeRootTurn({ id: SessionId('sdk-foreign-root'), resume: false,
            message: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'foreign root task' }] }) }, call.signal)
        }
        const result = await execution.delegate(call.agent, call.session, {
          id: SessionId(call.session.id === 'sdk-foreign-root' ? 'sdk-foreign-child' : 'sdk-recorded-child'),
          config: { ...config, maxSteps: 1 }, maxDepth: 1,
          message: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'child task' }] }),
        }, call.signal)
        return { content: [{ type: 'text', text: result.answer ?? '' }], isError: result.exitCode !== 0 }
      },
    }, context.scope))
    context.own(async () => { await foreign?.dispose() })
  },
}

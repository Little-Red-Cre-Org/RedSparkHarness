/** Reversible native run_code Consumer; the application owns its Session result. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { createNativePtcDispatch, type NativeProjectedToolContribution } from '@deepseek-ai/dsh-native-tools'
import type { CodeBindingNamespace, CodeRunResult } from '@deepseek-ai/dsh-native-code-runtime'
import { renderToolsSdkDeclarations } from '@deepseek-ai/dsh-native-tools/sdk-typescript'
import { renderToolsSdkPyDeclarations } from '@deepseek-ai/dsh-native-tools/sdk-python'
export type {} from '@deepseek-ai/dsh-native-prompt/native'
export type {} from '@deepseek-ai/dsh-native-tools/native'
export type {} from '@deepseek-ai/dsh-native-code-runtime/native'
export type {} from '@deepseek-ai/dsh-fs/native'
export type {} from '@deepseek-ai/dsh-native-sandbox-policy/native'
import { ToolArgsError } from '@deepseek-ai/dsh-native-tools/json-schema'
import { renderCodeOutput } from '@deepseek-ai/dsh-native-tools/code-output'

/** Canonical transport output; Provider completion values are exposed under result. */
type CodeToolOutcome = Omit<CodeRunResult, 'value'> & { result?: CodeRunResult['value'] }

function resolveConfig(input: unknown): { maxParallel: number; sdkPrompt: boolean } {
  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
    throw new Error('tool-code-runtime: configuration must be an object')
  }
  const fields = input as Record<string, unknown> | undefined
  if (Object.keys(fields ?? {}).some(key => !['maxParallelSubCalls', 'sdkPrompt'].includes(key))) {
    throw new Error('tool-code-runtime: unknown configuration field')
  }
  const maxParallel = fields?.maxParallelSubCalls ?? 10
  if (typeof maxParallel !== 'number' || !Number.isSafeInteger(maxParallel) || maxParallel < 1) {
    throw new Error('tool-code-runtime: maxParallelSubCalls must be a positive safe integer')
  }
  const sdkPrompt = fields?.sdkPrompt ?? false
  if (typeof sdkPrompt !== 'boolean') throw new Error('tool-code-runtime: sdkPrompt must be a boolean')
  return { maxParallel, sdkPrompt }
}

/** Register run_code through the same scoped registry as other model tools. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-tool-code-runtime', targets: ['host'],
  requires: ['tools', 'codeRuntime', 'fs'], optional: ['sandboxPolicy', 'promptSections'], provides: [],
  resolve(input) {
    const { maxParallel, sdkPrompt } = resolveConfig(input)
    return (context) => {
      const runtime = context.require('codeRuntime')
      const tools = context.require('tools')
      const prompts = context.optional('promptSections')
      if (sdkPrompt && prompts === undefined) throw new Error('tool-code-runtime: sdkPrompt requires promptSections')
      if (runtime.language !== 'typescript' && runtime.language !== 'python') {
        throw new Error(`tool-code-runtime: unsupported codeRuntime language ${JSON.stringify(runtime.language)}`)
      }
      const python = runtime.language === 'python'
      const filesystem = context.require('fs')
      const policy = context.optional('sandboxPolicy')
      if (runtime.isolation === 'process-sandbox' && policy === undefined) {
        throw new Error('tool-code-runtime: process-sandbox codeRuntime requires sandboxPolicy')
      }
      if (runtime.isolation !== 'process-sandbox' && policy?.defaultMode !== 'danger-full-access'
        && (policy !== undefined || filesystem.sandboxMode !== undefined)) {
        throw new Error('tool-code-runtime: codeRuntime requires danger-full-access while no sandbox-enforcing code runtime is installed')
      }
      const tool: NativeProjectedToolContribution = {
        schema: {
          name: 'run_code', description: `Execute a ${python ? 'Python' : 'TypeScript'} program against the available tools. `
            + 'Provide code as the body of an async function and a short description of what it does. '
            + 'Top-level await and return work; call the declared tools bindings for standard JSON results.', parameters: {
            type: 'object', properties: {
              code: { type: 'string', description: python ? 'The body of an async Python function.' : 'The body of an async TypeScript function; erasable syntax only.' },
              description: { type: 'string', description: 'A concise active-voice summary of what this program does.' },
            }, required: ['code', 'description'], additionalProperties: false,
          },
        },
        output: {
          schema: {
            type: 'object', properties: {
              logs: { type: 'array', items: { type: 'string' } }, result: {},
              error: { type: 'object', properties: {
                kind: { type: 'string', enum: ['exception', 'timeout', 'abort', 'worker-exit', 'invalid-output', 'output-limit'] },
                message: { type: 'string' },
              }, required: ['kind', 'message'], additionalProperties: false },
            }, required: ['logs'], additionalProperties: false,
          },
          render(_call, value) {
            const result = value as unknown as CodeToolOutcome
            const logsText = result.logs.length > 0 ? `\nCaptured output:\n${result.logs.join('\n')}` : ''
            const text = result.error === undefined ? renderCodeOutput(result.logs, result.result)
              : `code run failed (${result.error.kind}): ${result.error.message}${logsText}`
            return {
              content: [{ type: 'text', text }], isError: result.error !== undefined,
              ...result.error === undefined ? {} : { error: {
                name: 'NativeCodeRuntimeError', code: `CODE_RUNTIME_${result.error.kind.toUpperCase().replaceAll('-', '_')}`,
              } },
            }
          },
        },
        async execute(call) {
          if (runtime.isolation === 'process-sandbox' && policy?.config.workspaceRoot !== call.session.header.cwd) {
            throw new Error('tool-code-runtime: codeRuntime sandbox workspace differs from Session cwd')
          }
          const { code, description } = call.arguments as { code: string; description: string }
          if (description.trim().length === 0) {
            throw new ToolArgsError(['description: expected a non-empty string'])
          }
          const schemas = tools.sdkSchemas(call.agent.scope).filter(schema => schema.name !== 'run_code')
          const dispatch = createNativePtcDispatch(tools, call, maxParallel)
          const bindings: CodeBindingNamespace[] = schemas.length === 0 ? [] : [{
            global: 'tools', errorClass: { name: 'ToolCallError', memberNameProperty: 'toolName' },
            functions: Object.fromEntries(schemas.map(schema => [schema.name, async (args: unknown) => {
              const result = await dispatch.dispatch(schema.name, args)
              if (result.isError) {
                const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
                throw new Error(`tool ${schema.name} failed: ${text}`)
              }
              if (result.value === undefined) throw new Error(`tool ${schema.name} omitted its standard result`)
              return result.value
            }])),
          }]
          let closing: Promise<void> | undefined
          const closeDispatch = (): Promise<void> => {
            if (closing === undefined) {
              closing = dispatch.close()
              void closing.catch(() => { /* The execution cleanup awaits this same rejection. */ })
            }
            return closing
          }
          let value: CodeRunResult
          try {
            value = await runtime.run({
              program: code, bindings, signal: dispatch.signal,
              onStop() { void closeDispatch() },
            })
          }
          catch (error: unknown) {
            try { await closeDispatch() }
            catch (cleanup: unknown) { throw new AggregateError([error, cleanup], 'run_code execution and dispatch cleanup failed') }
            throw error
          }
          await closeDispatch()
          const { value: completion, ...outcome } = value
          return { value: { ...outcome, ...completion === undefined ? {} : { result: completion } },
            ...dispatch.additionalContexts.length === 0 ? {} : { additionalContexts: dispatch.additionalContexts },
            ...value.error === undefined && dispatch.concludesTurn ? { concludesTurn: true } : {},
          }
        },
      }
      context.effect(tools.registerProjectedTool(tool, context.scope))
      if (sdkPrompt && prompts !== undefined) {
        context.effect(prompts.register({
          name: 'tools:sdk', order: 0,
          text(scope = context.scope) {
            if (tools.modelMode === 'native') return ''
            const schemas = tools.sdkSchemas(scope).filter(schema => schema.name !== 'run_code')
            return (tools.modelMode === 'ptc' ? 'Call tools only through `run_code`; business names below are program bindings.\n\n' : '')
              + '## Writing code for run_code\n\n'
              + (python ? '`run_code` takes two required strings: `code`, the body of an async Python function, '
                : '`run_code` takes two required strings: `code`, the body of an async TypeScript function (erasable syntax only), ')
              + 'and `description`, a concise active-voice summary of what the program does. '
              + 'Top-level `await` and `return` work. '
              + 'Call the declared bindings as `await tools.name(args)` with lossless JSON arguments. '
              + 'Each call returns its canonical JSON value; failure rejects with `ToolCallError` and `toolName`. '
              + (python ? 'The declarations below are static stubs; TypedDict classes do not exist at runtime. '
                + 'Build arguments as plain dict/list JSON values. Use subscript access for exotic tool names. '
                + 'Independent safe calls may overlap with `asyncio.gather`; sequence dependent calls with `await`. '
                + 'Use `return` and `print` for output. '
                : 'Independent safe calls may overlap with `Promise.all`; sequence dependent calls with `await`. '
                + 'Use `return` and `console.log` for output. ')
              + 'The model sees captured logs and completion text, '
              + 'or a program failure. Successful nested images and sourced extra contexts are attached after the outer result. '
              + 'Other intermediate presentations stay out of the conversation. '
              + 'Only separately supplied tool schemas are directly callable.\n\n'
              + (python ? renderToolsSdkPyDeclarations(schemas) : renderToolsSdkDeclarations(schemas))
          },
        }))
      }
    }
  },
}

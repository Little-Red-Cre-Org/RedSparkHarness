/** Native model-facing questions over the selected human interaction Definition. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { JsonSchemaNode } from '@deepseek-ai/dsh-native-tools/json-schema'
export type {} from '@deepseek-ai/dsh-native-tools/native'
export type {} from '@deepseek-ai/dsh-user-questions/native'
import type { AskUserQuestionOption } from '@deepseek-ai/dsh-user-questions/native'

interface Arguments {
  readonly questions: {
    readonly id: string
    readonly question: string
    readonly header?: string
    readonly options?: AskUserQuestionOption[]
    readonly multi_select?: boolean
  }[]
}

const parameters: JsonSchemaNode & Record<string, unknown> = { type: 'object', required: ['questions'], additionalProperties: false, properties: {
  questions: { type: 'array', description: 'Questions to ask the user before continuing.', items: {
    type: 'object', required: ['id', 'question'], additionalProperties: true, properties: {
      id: { type: 'string', description: 'Stable id for this question; echoed in the answer.' },
      question: { type: 'string', description: 'The specific question to ask the user.' },
      header: { type: 'string', description: 'Optional short heading for the question, such as "Confirm" or "Choose Mode".' },
      options: { type: 'array', description: 'Optional choices to show the user. If you recommend one, put it first and append "(Recommended)" to that label.',
        items: { type: 'object', required: ['label'], additionalProperties: true, properties: {
          label: { type: 'string', description: 'Short user-facing option label.' },
          description: { type: 'string', description: 'One sentence explaining the tradeoff or impact.' },
        } } },
      multi_select: { type: 'boolean', description: 'Whether the user may select more than one option. Defaults to false.' },
    },
  } },
} }
const output: JsonSchemaNode = { type: 'object', required: ['answers'], additionalProperties: false, properties: {
  answers: { type: 'array', items: { type: 'object', required: ['id', 'selected'], additionalProperties: false, properties: {
    id: { type: 'string' }, selected: { type: 'array', items: { type: 'string' } }, custom: { type: 'string' },
  } } },
} }

/** Native Consumer; the selected Tools owner records the ordinary question result. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: 'tool-ask-user', targets: ['host'], requires: ['tools', 'userQuestions'], provides: [],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length > 0)) {
      throw new Error('tool-ask-user: configuration must be an empty object')
    }
    return (context) => {
      const questions = context.require('userQuestions')
      context.effect(context.require('tools').registerValueTool({
        schema: { name: 'ask_user_question', parameters,
          description: 'Ask the user a concise question when you need confirmation, a choice, or missing information before proceeding. '
            + 'Send one or more questions, each with a stable id that will be echoed in the answer.' },
        output: { schema: output, render: (_call, value) => ({ isError: false, content: [{ type: 'text', text: JSON.stringify(value) }] }) },
        async execute(call) {
          // NativeTools has validated these JSON fields against the registered input schema.
          const args = call.arguments as Arguments
          const answer = await questions.ask({ agent: call.agent, session: call.session, signal: call.signal,
            questions: args.questions.map(question => ({ id: question.id, question: question.question,
              ...question.header === undefined ? {} : { header: question.header },
              ...question.options === undefined ? {} : { options: question.options },
              ...question.multi_select === undefined ? {} : { multiSelect: question.multi_select },
            })),
          })
          return { answers: answer.answers.map(item => ({ id: item.id, selected: [...item.selected],
            ...item.custom === undefined ? {} : { custom: item.custom },
          })) }
        },
      }, context.scope))
    }
  },
}

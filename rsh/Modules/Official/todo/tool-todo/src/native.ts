/** Native todo Consumer over the selected Tool registry and authoritative Session. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-native-tools/native'
import type { JsonSchemaNode } from '@deepseek-ai/dsh-native-tools/json-schema'
import type { NativeValueToolContribution } from '@deepseek-ai/dsh-native-tools'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type {} from '@deepseek-ai/dsh-native-session-execution/native'
import { describe, toTodoList, validateTodos } from './todo-core.ts'
import type { TodoItem } from './todo-types.ts'
export type { TodoItem } from './todo-types.ts'

const itemSchema: JsonSchemaNode = {
  type: 'object', additionalProperties: false, required: ['content', 'status'],
  properties: { content: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] } },
}

/**
 * Read the standing plan from canonical history, including restored and inherited events.
 * @param owner - retained Session writer; turn start clears the previous plan.
 * @param signal - caller cancellation.
 * @returns latest whole list or null before a write in the current turn.
 */
export async function readTodos(owner: NativeActiveSessionOwner, signal: AbortSignal): Promise<readonly TodoItem[] | null> {
  signal.throwIfAborted()
  let todos: readonly TodoItem[] | null = null
  let open = false
  for (const event of await owner.readEvents({ signal })) {
    if (event.type === 'turn/start') { todos = null; open = true }
    if (event.type === 'turn/end') open = false
    if (event.type === 'todo/write') {
      if (!open) throw new Error('todo/write appended outside any open turn')
      validateTodos(event.data.todos, (message) => { throw new Error(message) })
      todos = event.data.todos
    }
  }
  signal.throwIfAborted()
  return todos
}

function contribution(allowParallel: boolean, active: NativeActiveSessionOperations): NativeValueToolContribution {
  return {
    schema: {
      name: 'todo_write', description: describe(allowParallel),
      parameters: { type: 'object', additionalProperties: false, required: ['todos'], properties: {
        todos: { type: 'array', description: 'The COMPLETE task list, replacing any previous list.', items: itemSchema },
      } },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, required: ['todos', 'counts'], properties: {
        todos: { type: 'array', items: itemSchema },
        counts: { type: 'object', additionalProperties: false, required: ['pending', 'inProgress', 'completed'],
          properties: { pending: { type: 'integer' }, inProgress: { type: 'integer' }, completed: { type: 'integer' } } },
      } },
      render(_call, value) {
        const counts = (value as { counts: { pending: number; inProgress: number; completed: number } }).counts
        return { isError: false, content: [{ type: 'text',
          text: `Updated todo list: ${counts.pending} pending, ${counts.inProgress} in progress, ${counts.completed} completed.`,
        }] }
      },
    },
    async execute(call) {
      const todos = toTodoList((call.arguments as { todos: TodoItem[] }).todos, allowParallel)
      const owner = active.owner(call.agent, call.session)
      if (owner === undefined) throw new Error('todo_write requires an owning agent session')
      const history = await owner.readEvents({ signal: call.signal })
      const latest = history.findLast(event => event.type === 'turn/start' || event.type === 'turn/end')
      if (active.owner(call.agent, call.session) !== owner) throw new Error('todo_write Session owner was released')
      if (latest?.type !== 'turn/start') throw new Error('todo/write appended outside any open turn')
      call.signal.throwIfAborted()
      await call.appendEvent('todo/write', { todos })
      const count = (status: TodoItem['status']): number => todos.filter(todo => todo.status === status).length
      return { todos, counts: { pending: count('pending'), inProgress: count('in_progress'), completed: count('completed') } }
    },
  }
}

/** Scoped registration; disposal cancels and drains admitted todo calls. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-tool-todo', targets: ['host'], requires: ['tools', 'activeSessions'], provides: [],
  resolve(input) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('tool-todo: configuration must be an object')
    const config = input as Record<string, unknown>
    if (Object.keys(config).some(key => key !== 'allowParallelInProgress') || typeof config.allowParallelInProgress !== 'boolean') {
      throw new Error('tool-todo: allowParallelInProgress is required and must be boolean')
    }
    const allowParallel = config.allowParallelInProgress
    return (context) => {
      const tool = contribution(allowParallel, context.require('activeSessions'))
      context.effect(context.require('tools').registerValueTool(tool, context.scope))
    }
  },
}

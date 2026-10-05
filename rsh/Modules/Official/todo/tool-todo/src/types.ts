/** Todo payload and compatibility projection declarations. */
import type { TodoItem } from './todo-types.ts'
export type { TodoItem } from './todo-types.ts'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    todos: TodoItem[] | null
  }
  interface SessionProjectionMap {
    /**
     * The agent's current whole todo list (the latest `todo/write` snapshot),
     * or `null` before the first write. Whole-value rule: every `todo/write`
     * carries the complete replacement list, so the fold is last-wins.
     */
    todos: TodoItem[] | null
  }
}

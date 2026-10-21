/**
 * Host-only start request. The shared live-run handle and durable vocabulary
 * remain in `./types` so native and Client consumers avoid the Agent type.
 *
 * @module @deepseek-ai/dsh-workflow
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { WorkflowMeta } from './types.ts'

export type { WorkflowRun } from './types.ts'

/**
 * What a caller asks for when starting a workflow run. `meta` and `args` are
 * plain JSON data by the seam contract. `parent` is required because every
 * `agent()` spawned by the script is attributed to that live Agent.
 */
export interface WorkflowStartRequest {
  /** The plain-JS script body (top-level await allowed; ends with `return <json-value>`). */
  script: string
  /** The workflow's identity block, as plain JSON data (shape-validated by the engine). */
  meta: WorkflowMeta
  /** Optional input exposed verbatim to the script as the `args` global. */
  args?: unknown
  /** Optional engine-wide child-provider override for this run. */
  subagentProvider?: string
  /** Optional per-run total-child ceiling. */
  maxTotalAgents?: number
  /** The agent on whose behalf the run executes (parent of every child). */
  parent: Agent
  /** Cancels the run when aborted. */
  signal?: AbortSignal
}

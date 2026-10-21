/** Browser-safe Goal protocol values and branded identities. */
import type { GoalId as GoalIdType } from './types.ts'

/** Version of the goal change embedded in a round-zero message source. */
export const GOAL_CHANGE_VERSION = 1

/**
 * Brand a string as a goal id.
 * @param id - raw goal identifier.
 * @returns the same string with the compile-time brand.
 */
export function GoalId(id: string): GoalIdType {
  return id as GoalIdType
}

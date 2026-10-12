/** Conversation client type augmentation for the Trajectory snapshot. */
import type { TrajectorySnapshot } from './trajectory-contract.ts'

export type { TrajectorySnapshot } from './trajectory-contract.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationViewSnapshotMap {
    /** Independently assembled data consumed by the Trajectory view. */
    trajectory: TrajectorySnapshot
  }
}

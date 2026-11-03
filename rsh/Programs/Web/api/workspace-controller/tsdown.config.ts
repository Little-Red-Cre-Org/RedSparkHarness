import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@redspark/rsh-api-workspace-controller',
  ['lib/types/index.js'],
  { hostPhase: true },
)

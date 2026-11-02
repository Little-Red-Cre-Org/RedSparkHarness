import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@redspark/rsh-api-remotes',
  ['lib/types/index.js'],
  { hostPhase: true },
)

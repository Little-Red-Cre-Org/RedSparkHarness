import { clientBundle } from '../../../Programs/Web/client/tsdown.client.ts'

export default clientBundle(
  '@redspark/rsh-session-log-export',
  ['lib/types/{index,native}.js'],
  { hostPhase: true, lib: { outputOptions: { chunkFileNames: 'shared-[hash].js' } } },
)

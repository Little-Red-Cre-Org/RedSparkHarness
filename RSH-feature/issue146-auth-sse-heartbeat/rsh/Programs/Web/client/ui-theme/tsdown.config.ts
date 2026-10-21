import { clientBundle, staticLinkedLeaf } from '../tsdown.client.ts'

const compatibility = clientBundle(
  '@deepseek-ai/dsh-client-ui-theme',
  ['lib/types/index.js', 'lib/types/theme-contract.js'],
)
const native = staticLinkedLeaf('@deepseek-ai/dsh-client-ui-theme', ['lib/types/native.js'])

export default (args: Parameters<typeof compatibility>[0]) => [...compatibility(args), ...native(args)]

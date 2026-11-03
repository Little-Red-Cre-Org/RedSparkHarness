import { clientBundle, staticLinkedLeaf } from '../tsdown.client.ts'

const compatibility = clientBundle('@redspark/rsh-client-ui-subagent', ['lib/types/index.js'])
const native = staticLinkedLeaf('@redspark/rsh-client-ui-subagent', ['lib/types/native.js'])

export default (args: Parameters<typeof compatibility>[0]) => [...compatibility(args), ...native(args)]

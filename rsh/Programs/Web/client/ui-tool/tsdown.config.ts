import { clientBundle, staticLinkedLeaf } from '../tsdown.client.ts'

const legacy = clientBundle('@redspark/rsh-client-ui-tool', ['lib/types/index.js'])

const native = staticLinkedLeaf('@redspark/rsh-client-ui-tool', ['lib/types/native.js', 'lib/types/tool-renderer.js'])

export default (args: Parameters<typeof legacy>[0]) => [...legacy(args), ...native(args)]

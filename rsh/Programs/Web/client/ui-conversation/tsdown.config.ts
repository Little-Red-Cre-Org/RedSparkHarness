import { clientBundle, staticLinkedLeaf } from '../tsdown.client.ts'

const legacy = clientBundle('@redspark/rsh-client-ui-conversation', ['lib/types/index.js'])

const native = staticLinkedLeaf('@redspark/rsh-client-ui-conversation', ["lib/types/tool-records.js","lib/types/conversation-copy.js"])

export default (args: Parameters<typeof legacy>[0]) => [...legacy(args), ...native(args)]

import { clientBundle, staticLinkedLeaf } from '../tsdown.client.ts'

const legacy = clientBundle('@deepseek-ai/dsh-client-ui-conversation', ['lib/types/index.js'])

const native = staticLinkedLeaf('@deepseek-ai/dsh-client-ui-conversation', ["lib/types/tool-records.js","lib/types/conversation-copy.js"])

export default (args: Parameters<typeof legacy>[0]) => [...legacy(args), ...native(args)]

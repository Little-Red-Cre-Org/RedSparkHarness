import { clientBundle, staticLinkedLeaf } from '../tsdown.client.ts'

const legacy = clientBundle('@deepseek-ai/dsh-client-locale', ['lib/types/index.js'])

const native = staticLinkedLeaf('@deepseek-ai/dsh-client-locale', ["lib/types/dictionary.js"])

export default (args: Parameters<typeof legacy>[0]) => [...legacy(args), ...native(args)]

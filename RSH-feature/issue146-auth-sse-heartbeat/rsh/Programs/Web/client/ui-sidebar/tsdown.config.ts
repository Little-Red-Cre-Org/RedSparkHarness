import { clientBundle, staticLinkedLeaf } from '../tsdown.client.ts'

const compatibility = clientBundle('@deepseek-ai/dsh-client-ui-sidebar', ['lib/types/index.js'])
const native = staticLinkedLeaf('@deepseek-ai/dsh-client-ui-sidebar', ['lib/types/native.js'])

export default (args: Parameters<typeof compatibility>[0]) => [...compatibility(args), ...native(args)]

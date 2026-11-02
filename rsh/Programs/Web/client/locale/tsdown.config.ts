import { clientBundle, staticLinkedLeaf } from '../tsdown.client.ts'

const legacy = clientBundle('@redspark/rsh-client-locale', ['lib/types/index.js'])

const native = staticLinkedLeaf('@redspark/rsh-client-locale', ["lib/types/dictionary.js"])
const nativeInstaller = staticLinkedLeaf('@redspark/rsh-client-locale', ['lib/types/native.js'])

export default (args: Parameters<typeof legacy>[0]) => [...legacy(args), ...native(args), ...nativeInstaller(args)]

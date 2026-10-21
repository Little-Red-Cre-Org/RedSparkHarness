import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-connection', [
  'lib/types/index.js', 'lib/types/native.js', 'lib/types/native-host.js', 'lib/types/http-bridge.js', 'lib/types/native-http-bridge.js',
])

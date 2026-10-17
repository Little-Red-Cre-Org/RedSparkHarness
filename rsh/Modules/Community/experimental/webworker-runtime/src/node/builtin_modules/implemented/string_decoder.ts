/**
 * `node:string_decoder` compatibility backed by the maintained userland
 * implementation used by `readable-stream`.
 */
import { StringDecoder } from 'string_decoder'

/** Default CommonJS-compatible namespace for Node string-decoder imports. */
const nodeStringDecoder = { StringDecoder }

export { StringDecoder }

/** CommonJS interop marker consumed by the worker module loader. */
export const __esModule = true

/** CommonJS-compatible namespace for default imports. */
export default nodeStringDecoder satisfies typeof import('node:string_decoder')

/** Profile application consuming the selected Native IDE Provider. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-ide-code-oss'

/** Print the workspace URL and retain the IDE until cancellation or server exit. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-native-ide',
  targets: ['host'],
  requires: ['ide'],
  provides: ['application'],
  resolve(input) {
    if (input !== undefined) throw new Error('native IDE application accepts no configuration')
    return (context) => {
      const ide = context.require('ide')
      context.provide('application', {
        async run(args, signal) {
          if (args.length > 0) throw new Error('native IDE uses profile configuration; task arguments are unsupported')
          signal.throwIfAborted()
          process.stdout.write(`${ide.url}\n`)
          const stopped = Promise.withResolvers<number>()
          const stop = (): void => { stopped.resolve(0) }
          signal.addEventListener('abort', stop, { once: true })
          try {
            return await Promise.race([ide.exited, stopped.promise])
          } finally {
            signal.removeEventListener('abort', stop)
          }
        },
      })
    }
  },
}

import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@deepseek-ai/cordis')) {
      throw new Error(`native CLI imported Cordis from ${context.parentURL}`)
    }
    return nextResolve(specifier, context)
  },
})

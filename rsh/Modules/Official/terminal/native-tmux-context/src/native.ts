/** Native Host Provider for durable tmux location context. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeTmuxContextProvider, resolveNativeTmuxContextConfig } from './index.ts'

/** Native tmux location Provider; the shell service owns query execution and cancellation. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-tmux-context', targets: ['host'],
  requires: [], optional: ['shell'], provides: ['tmuxContext'],
  resolve(input) {
    const config = resolveNativeTmuxContextConfig(input)
    return (context) => {
      context.provide('tmuxContext', new NativeTmuxContextProvider(config, context.optional('shell'), context.signal))
    }
  },
}

/** Native Agent publication and completed-disposal event declarations. */
import type { NativeAgent } from './index.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeEvents {
    /** Exact Agent registered before synchronous publication. @mode sync @param agent - newly live identity. */
    'agent/created': { mode: 'sync'; args: [agent: NativeAgent]; result: void }
    /** Exact Agent removed after registered cleanup drains. @mode sync @param agent - disposed identity. */
    'agent/disposed': { mode: 'sync'; args: [agent: NativeAgent]; result: void }
  }
}

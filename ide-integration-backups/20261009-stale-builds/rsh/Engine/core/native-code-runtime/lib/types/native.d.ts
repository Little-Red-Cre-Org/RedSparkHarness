/** Native Host Provider wiring for the worker-thread code runtime. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime';
import type { NativeCodeRuntime } from './index.ts';
declare module '@deepseek-ai/dsh-native-runtime' {
    interface NativeServices {
        codeRuntime: NativeCodeRuntime;
    }
}
/** Native worker-thread code-runtime Provider with explicit validated budgets. */
export declare const plugin: NativePlugin;
//# sourceMappingURL=native.d.ts.map
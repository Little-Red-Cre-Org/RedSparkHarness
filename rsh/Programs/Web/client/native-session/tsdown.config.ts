import { defineConfig } from 'tsdown'
export default defineConfig({ name: '@deepseek-ai/dsh-client-native-session/client', entry: ['lib/types/index.js', 'lib/types/native.js', 'lib/types/follow-types.js', 'lib/types/model-controls.js', 'lib/types/human.js'], outDir: 'lib', format: ['esm'], platform: 'browser', target: 'es2024', fixedExtension: false, dts: false, clean: false })

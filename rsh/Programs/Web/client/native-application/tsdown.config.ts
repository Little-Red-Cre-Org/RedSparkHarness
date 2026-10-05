import { defineConfig } from 'tsdown'
export default defineConfig({ name: '@deepseek-ai/dsh-client-native-application/client', entry: ['lib/types/index.js', 'lib/types/native.js'], outDir: 'lib', format: ['esm'], platform: 'browser', target: 'es2024', fixedExtension: false, dts: false, clean: false })

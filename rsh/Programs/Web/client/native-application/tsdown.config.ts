import { defineConfig } from 'tsdown'
import { clientOnly } from '../tsdown.client.ts'

export default clientOnly([defineConfig({ name: '@deepseek-ai/dsh-client-native-application/client', entry: ['lib/types/index.js', 'lib/types/native.js', 'lib/types/controller.js'], outDir: 'lib', format: ['esm'], platform: 'browser', target: 'es2024', fixedExtension: false, dts: false, clean: false })])

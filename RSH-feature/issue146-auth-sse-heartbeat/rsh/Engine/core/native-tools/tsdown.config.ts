import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/json-schema.js', 'lib/types/code-output.js', 'lib/types/ts-types.js', 'lib/types/py-types.js',
    'lib/types/ordered-dispatch.js', 'lib/types/types.js', 'lib/types/presentation.js'],
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
  outputOptions: { chunkFileNames: 'shared-[hash].js' },
})

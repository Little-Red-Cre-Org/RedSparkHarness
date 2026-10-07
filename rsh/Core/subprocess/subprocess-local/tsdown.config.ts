import { defineConfig } from 'tsdown'

// Both registration paths share one process controller and platform helpers.
export default defineConfig({
  entry: {
    index: 'lib/types/index.js', native: 'lib/types/native.js',
    'child-connection': 'lib/types/child-connection.js', runner: 'lib/types/bin.js',
  },
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
  outputOptions: { chunkFileNames: 'shared-[hash].js', entryFileNames: '[name].js' },
})

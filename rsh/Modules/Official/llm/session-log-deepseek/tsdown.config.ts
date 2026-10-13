import { defineConfig } from 'tsdown'

/** Build both session-log entries over their shared wire and watermark logic. */
export default defineConfig({
  entry: ['lib/types/{index,invariant,native}.js'],
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
  outputOptions: { chunkFileNames: 'shared-[hash].js' },
})

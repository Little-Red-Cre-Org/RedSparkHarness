import { defineConfig } from 'tsdown'

/** Bundle both installers over one connection supervisor and protocol bridge. */
export default defineConfig({
  entry: ['lib/types/{index,native,types}.js'], outDir: 'lib',
  format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false,
  dts: false, clean: false, outputOptions: { chunkFileNames: 'shared-[hash].js' },
})

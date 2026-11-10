import { defineConfig } from 'tsdown'

/** Build the Cordis and native present entries over the shared delivered-file record. */
export default defineConfig({
  entry: ['lib/types/{index,native}.js'],
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
})

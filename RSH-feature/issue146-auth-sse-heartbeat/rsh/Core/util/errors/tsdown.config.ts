import { defineConfig } from 'tsdown'

/** Publish shared error helpers from their canonical TypeScript output. */
export default defineConfig({
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'neutral',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})

import { defineConfig } from 'tsdown'

/** Publish native entries beside the existing compatibility exports. */
export default defineConfig({
  tsconfig: false, entry: ["lib/types/index.js", "lib/types/invariant.js", "lib/types/native.js", "lib/types/selection.js"],
  deps: { neverBundle: ['@deepseek-ai/dsh-agent-presets'] },
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false, outputOptions: { chunkFileNames: 'shared-[hash].js' },
})

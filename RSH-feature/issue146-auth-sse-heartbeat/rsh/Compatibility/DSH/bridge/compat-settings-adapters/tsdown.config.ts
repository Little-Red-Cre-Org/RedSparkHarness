import { defineConfig } from 'tsdown'

/** Build the root exports and four separately selectable Cordis entries. */
export default defineConfig({
  entry: [
    'lib/types/index.js',
    'lib/types/agent-loop.js',
    'lib/types/agent-default-model.js',
    'lib/types/agent-presets.js',
    'lib/types/tool-subagent.js',
  ],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})

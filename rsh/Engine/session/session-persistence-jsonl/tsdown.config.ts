import { defineConfig } from 'tsdown'

const output = {
  outDir: 'lib', format: ['esm'] as const, platform: 'node' as const, target: 'es2024' as const,
  fixedExtension: false, dts: false, clean: false,
}

export default defineConfig([
  { ...output, entry: ['lib/types/index.js'] },
  { ...output, entry: ['lib/types/native.js'] },
  {
    ...output,
    entry: ['lib/types/worker.js'],
    // Its plain request/result messages need no host singletons; leave native add-ons external.
    deps: { alwaysBundle: [/^@deepseek-ai\/(?!node-addon-system)/] },
    format: ['cjs'] as const,
  },
])

import { clientBundle } from '../tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-client-modules',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { companions: [{
    entry: ['lib/types/client/native.js'], outDir: 'lib', format: ['esm'],
    platform: 'browser', target: 'es2024', fixedExtension: false, dts: false, clean: false,
  }] },
)

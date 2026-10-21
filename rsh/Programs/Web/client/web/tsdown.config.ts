import { clientOnly, staticLinked } from '../tsdown.client.ts'

const legacy = staticLinked(
  '@deepseek-ai/dsh-client-web',
  ['lib/types/index.js'],
)

const native = clientOnly([{
  entry: ['lib/types/native-boot.js'], outDir: 'lib', format: ['esm'],
  platform: 'browser', target: 'es2024', fixedExtension: false, dts: false, clean: false,
}])

export default (args: Parameters<typeof legacy>[0]) => [...legacy(args), ...native(args)]

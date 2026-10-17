import { clientOnly, staticLinked } from '../tsdown.client.ts'

const native = staticLinked('@deepseek-ai/dsh-client-web', [
  'lib/types/index.js',
  'lib/types/boot-page.js',
  'lib/types/base-css.js',
])

const nativeAlias = clientOnly([{
  entry: ['lib/types/native-boot.js'], outDir: 'lib', format: ['esm'],
  platform: 'browser', target: 'es2024', fixedExtension: false, dts: false, clean: false,
}])

export default (args: Parameters<typeof native>[0]) => [...native(args), ...nativeAlias(args)]

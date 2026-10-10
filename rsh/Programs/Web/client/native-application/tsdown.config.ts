import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'
import { clientOnly } from '../tsdown.client.ts'

const accountCardStyles = fileURLToPath(new URL('./src/account-card.module.css', import.meta.url))

export default clientOnly([defineConfig({ name: '@deepseek-ai/dsh-client-native-application/client', entry: ['lib/types/index.js', 'lib/types/native.js', 'lib/types/controller.js'], outDir: 'lib', format: ['esm'], platform: 'browser', target: 'es2024', fixedExtension: false, dts: false, clean: false, plugins: [{
  name: 'native-application-css-asset',
  async resolveId(this: {
    emitFile(file: { type: 'asset'; fileName: string; source: Uint8Array; originalFileName: string }): string
  }, source: string, importer: string | undefined) {
    if (source !== './account-card.module.css' || importer === undefined) return null
    this.emitFile({ type: 'asset', fileName: 'account-card.module.css', source: await readFile(accountCardStyles), originalFileName: accountCardStyles })
    return { id: './account-card.module.css', external: true }
  },
}] })])

/** A packed-style consumer imports the built asset handler without Cordis installed. */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url))

it('loads the built native asset routes in an installed consumer without Cordis', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-native-web-assets-'))
  try {
    const installed = join(home, 'node_modules', '@deepseek-ai', 'dsh-native-web-assets')
    const frontend = join(home, 'node_modules', '@deepseek-ai', 'dsh-web-frontend')
    mkdirSync(join(installed, 'lib'), { recursive: true })
    mkdirSync(join(frontend, 'dist'), { recursive: true })
    copyFileSync(join(PACKAGE_ROOT, 'package.json'), join(installed, 'package.json'))
    copyFileSync(join(PACKAGE_ROOT, 'lib', 'index.js'), join(installed, 'lib', 'index.js'))
    for (const file of readdirSync(join(PACKAGE_ROOT, 'lib')).filter(name => /^shared-.*\.js$/u.test(name))) {
      copyFileSync(join(PACKAGE_ROOT, 'lib', file), join(installed, 'lib', file))
    }
    writeFileSync(join(home, 'package.json'), '{"type":"module"}\n')
    writeFileSync(join(frontend, 'package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh-web-frontend', exports: { './dist/*': './dist/*' },
    }))
    writeFileSync(join(frontend, 'dist', 'native.html'), '<!doctype html><html><head></head><body><main>page</main></body></html>')
    writeFileSync(join(frontend, 'dist', 'native.js'), 'globalThis.nativePage = true')
    writeFileSync(join(home, 'consumer.mjs'), [
      "import { createNativeDesktopAssetHandler } from '@deepseek-ai/dsh-native-web-assets'",
      'const bundle = { wire: { formatVersion: 1, bundle: "/.dsh/native-client/profile.js" },',
      '  assets: new Map([["/.dsh/native-client/profile.js", { contentType: "text/javascript", body: new TextEncoder().encode("export default true") }]]) }',
      'const handler = createNativeDesktopAssetHandler(process.cwd(), bundle, "globalThis.nativeTransport = true")',
      'const page = await handler.fetch(new Request("https://dsh.example/"))',
      'const fallback = await handler.fetch(new Request("https://dsh.example/index.html"))',
      'const asset = await handler.fetch(new Request("https://dsh.example/.dsh/native-client/profile.js"))',
      'const staticAsset = await handler.fetch(new Request("https://dsh.example/native.js"))',
      'if (page.status !== 200 || !(await page.text()).includes("__DSH_NATIVE_CLIENT_BOOT__")',
      '  || !(await fallback.text()).includes("__DSH_NATIVE_CLIENT_BOOT__")',
      '  || (await asset.text()) !== "export default true"',
      '  || (await staticAsset.text()) !== "globalThis.nativePage = true") process.exitCode = 1',
    ].join('\n'))
    expect(existsSync(join(home, 'node_modules', ...'@deepseek-ai/cordis'.split('/')))).toBe(false)
    const result = spawnSync(process.execPath, ['consumer.mjs'], { cwd: home, encoding: 'utf8' })
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(readFileSync(join(installed, 'lib', 'index.js'), 'utf8').toLowerCase()).not.toContain('@deepseek-ai/cordis')
  } finally {
    const resolved = realpathSync(home)
    const temporaryRoot = realpathSync(tmpdir())
    if (!resolved.startsWith(`${temporaryRoot}${sep}`)) {
      throw new Error('native asset consumer cleanup escaped the temporary directory')
    }
    rmSync(resolved, { recursive: true, force: true })
  }
})

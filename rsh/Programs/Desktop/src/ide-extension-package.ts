/** Package the shell's built Code OSS adapter as a local VSIX, without registry access. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { ideConfigurationDefaults, ideTheme } from './ide-theme.ts'
import { workbenchMessages } from './ide-locale.ts'

/**
 * Write the bundled adapter into this launch's private directory.
 * @param directory - Desktop-owned launch directory, already created.
 * @param locale - Desktop locale for RSH controls without an upstream language pack.
 * @returns absolute VSIX path passed to the upstream extension installer.
 */
export async function packageIdeExtension(directory: string, locale: string): Promise<string> {
  const manifest = {
    name: 'rsh-workbench', publisher: 'redspark', version: '0.1.9',
    displayName: 'RedSpark Harness', description: 'RSH task conversations in the shared workbench',
    engines: { vscode: '^1.100.0' }, main: './extension.cjs', extensionKind: ['workspace'],
    activationEvents: ['onStartupFinished'],
    capabilities: { untrustedWorkspaces: { supported: true } },
    contributes: {
      configuration: { title: 'RSH', properties: {
        'rsh.autoSaveDelay': { type: 'integer', default: 500, minimum: 100, maximum: 10000,
          scope: 'window', description: '%autoSaveDelay%' },
      } },
      configurationDefaults: ideConfigurationDefaults,
      themes: [{ label: 'RSH Warm White', uiTheme: 'vs', path: './warm-white.json' }],
      keybindings: [
        { command: 'rsh.conversation', key: 'alt+1' },
        { command: 'rsh.coding', key: 'alt+2' },
        { command: 'rsh.addSelection', key: 'ctrl+alt+l', mac: 'cmd+alt+l', when: 'editorTextFocus && editorHasSelection' },
      ],
      commands: [
        { command: 'rsh.return', title: '%returnRsh%', category: 'RSH', icon: '$(arrow-left)' },
        { command: 'rsh.conversation', title: '%conversation%', category: 'RSH', icon: '$(comment-discussion)' },
        { command: 'rsh.newTask', title: '%newTask%', category: 'RSH', icon: '$(add)' },
        { command: 'rsh.coding', title: '%coding%', category: 'RSH', icon: '$(code)' },
        { command: 'rsh.addSelection', title: '%addSelection%', category: 'RSH' },
      ],
      views: { explorer: [{ id: 'rsh.tasks', name: '%tasks%' }] },
      menus: {
        'editor/context': [{ command: 'rsh.addSelection', when: 'editorHasSelection', group: 'rsh' }],
        'view/title': [{ command: 'rsh.newTask', when: 'view == rsh.tasks', group: 'navigation' }],
        'editor/title': [
          { command: 'rsh.conversation', group: 'navigation@1' },
          { command: 'rsh.coding', group: 'navigation@2' },
        ],
      },
    },
  }
  const xml = '<?xml version="1.0" encoding="utf-8"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="rsh-workbench" Version="0.1.9" Publisher="redspark"/><DisplayName>RedSpark Harness</DisplayName><Description xml:space="preserve">RSH workbench integration</Description><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.100.0"/></Properties></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>'
  const contentTypes = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="cjs" ContentType="application/javascript"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>'
  const bytes = zipSync({
    'extension/package.json': strToU8(JSON.stringify(manifest)),
    'extension/warm-white.json': strToU8(JSON.stringify(ideTheme)),
    'extension/package.nls.json': strToU8(JSON.stringify(workbenchMessages(locale))),
    'extension/package.nls.zh-cn.json': strToU8(JSON.stringify(workbenchMessages('zh'))),
    'extension/extension.cjs': await readFile(new URL('./ide-extension.cjs', import.meta.url)),
    'extension.vsixmanifest': strToU8(xml), '[Content_Types].xml': strToU8(contentTypes),
  })
  const path = join(directory, 'rsh-workbench.vsix')
  await writeFile(path, bytes, { flag: 'wx' })
  return path
}

/** Package the shell's built Code OSS adapter as a local VSIX, without registry access. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { ideConfigurationDefaults, ideTheme } from './ide-theme.ts'
import { workbenchMessages } from './ide-locale.ts'
import { javaRunner } from './ide-java-runner.ts'
import { cRunner } from './ide-c-runner.ts'

/**
 * Write the bundled adapter into this launch's private directory.
 * @param directory - Desktop-owned launch directory, already created.
 * @param locale - Desktop locale for RSH controls without an upstream language pack.
 * @returns absolute VSIX path passed to the upstream extension installer.
 */
export async function packageIdeExtension(directory: string, locale: string): Promise<string> {
  const manifest = {
    name: 'rsh-workbench', publisher: 'redspark', version: '0.1.14',
    displayName: 'RedSpark Harness', description: 'RSH task conversations in the shared workbench',
    engines: { vscode: '^1.135.0' }, main: './extension.cjs', extensionKind: ['workspace'],
    activationEvents: ['onStartupFinished'],
    capabilities: { untrustedWorkspaces: { supported: true } },
    contributes: {
      configuration: { title: 'RSH', properties: {
        'rsh.pythonExecutable': { type: 'string', default: 'python', scope: 'resource', description: '%pythonExecutable%' },
        'rsh.javaExecutable': { type: 'string', default: 'java', scope: 'resource', description: '%javaExecutable%' },
        'rsh.javacExecutable': { type: 'string', default: 'javac', scope: 'resource', description: '%javacExecutable%' },
        'rsh.cCompiler': { type: 'string', default: 'gcc', scope: 'resource', description: '%cCompiler%' },
        'rsh.cppCompiler': { type: 'string', default: 'g++', scope: 'resource', description: '%cppCompiler%' },
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
        { command: 'rsh.runFile', title: '%runFile%', category: 'RSH', icon: '$(play)' },
        { command: 'rsh.runProject', title: '%runProject%', category: 'RSH', icon: '$(run-all)' },
        { command: 'rsh.stopRun', title: '%stopRun%', category: 'RSH', icon: '$(debug-stop)' },
        { command: 'rsh.newProject', title: '%newProject%', category: 'RSH', icon: '$(new-folder)' },
        { command: 'rsh.openProject', title: '%openProject%', category: 'RSH', icon: '$(folder-opened)' },
        { command: 'rsh.newFile', title: '%newFile%', category: 'RSH', icon: '$(new-file)' },
        { command: 'rsh.applyCode', title: '%applyCode%', category: 'RSH', icon: '$(check)' },
        { command: 'rsh.discardCode', title: '%discardCode%', category: 'RSH', icon: '$(close)' },
        { command: 'rsh.return', title: '%returnRsh%', category: 'RSH', icon: '$(arrow-left)' },
        { command: 'rsh.conversation', title: '%conversation%', category: 'RSH', icon: '$(comment-discussion)' },
        { command: 'rsh.newTask', title: '%newTask%', category: 'RSH', icon: '$(add)' },
        { command: 'rsh.coding', title: '%coding%', category: 'RSH', icon: '$(code)' },
        { command: 'rsh.addSelection', title: '%addSelection%', category: 'RSH' },
      ],
      viewsContainers: { secondarySidebar: [{ id: 'rsh', title: 'RSH AI', icon: '$(comment-discussion)' }] },
      views: { explorer: [{ id: 'rsh.tasks', name: '%tasks%' }], rsh: [{ id: 'rsh.ai', name: 'RSH AI', type: 'webview' }] },
      menus: {
        'editor/context': [{ command: 'rsh.addSelection', when: 'editorHasSelection', group: 'rsh' }],
        'view/title': [
          { command: 'rsh.newProject', when: 'view == rsh.ai', group: 'navigation@0' },
          { command: 'rsh.openProject', when: 'view == rsh.ai', group: 'navigation@1' },
          { command: 'rsh.newFile', when: 'view == rsh.ai', group: 'navigation@2' },
          { command: 'rsh.newTask', when: 'view == rsh.tasks || view == rsh.ai', group: 'navigation@3' },
        ],
        'editor/title': [
          { command: 'rsh.runFile', when: 'resourceScheme =~ /^(file|vscode-remote|untitled)$/', group: 'navigation@0' },
          { command: 'rsh.runProject', group: 'rshRun@1' },
          { command: 'rsh.stopRun', group: 'navigation@0' },
          { command: 'rsh.applyCode', when: 'resourceScheme == rsh-proposal', group: 'navigation@0' },
          { command: 'rsh.discardCode', when: 'resourceScheme == rsh-proposal', group: 'navigation@1' },
          { command: 'rsh.conversation', group: 'navigation@1' },
          { command: 'rsh.coding', group: 'navigation@2' },
        ],
      },
    },
  }
  const xml = '<?xml version="1.0" encoding="utf-8"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="rsh-workbench" Version="0.1.14" Publisher="redspark"/><DisplayName>RedSpark Harness</DisplayName><Description xml:space="preserve">RSH workbench integration</Description><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.135.0"/></Properties></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>'
  const contentTypes = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="cjs" ContentType="application/javascript"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>'
  const bytes = zipSync({
    'extension/package.json': strToU8(JSON.stringify(manifest)),
    'extension/warm-white.json': strToU8(JSON.stringify(ideTheme)),
    'extension/package.nls.json': strToU8(JSON.stringify(workbenchMessages(locale))),
    'extension/package.nls.zh-cn.json': strToU8(JSON.stringify(workbenchMessages('zh'))),
    'extension/extension.cjs': await readFile(new URL('./ide-extension.cjs', import.meta.url)),
    'extension/java-runner.cjs': strToU8(javaRunner),
    'extension/c-runner.cjs': strToU8(cRunner),
    'extension.vsixmanifest': strToU8(xml), '[Content_Types].xml': strToU8(contentTypes),
  })
  const path = join(directory, 'rsh-workbench.vsix')
  await writeFile(path, bytes, { flag: 'wx' })
  return path
}

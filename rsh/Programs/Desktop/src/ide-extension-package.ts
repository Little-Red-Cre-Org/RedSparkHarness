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
    name: 'rsh-workbench', publisher: 'redspark', version: '0.1.20',
    displayName: 'RedSpark Harness', description: 'RSH task conversations in the shared workbench',
    engines: { vscode: '^1.100.0' }, main: './extension.cjs', extensionKind: ['workspace'],
    activationEvents: ['onStartupFinished'],
    capabilities: { untrustedWorkspaces: { supported: true } },
    contributes: {
      taskDefinitions: [{ type: 'rsh-file', required: ['file'], properties: { file: { type: 'string' } } }],
      problemMatchers: [{ name: 'rsh-gcc', owner: 'rsh-gcc', fileLocation: 'absolute',
        pattern: { regexp: '^(.*):(\\d+):(\\d+):\\s+(?:fatal )?(warning|error):\\s+(.*)$',
          file: 1, line: 2, column: 3, severity: 4, message: 5 } }],
      configuration: { title: 'RSH', properties: {
        'rsh.runnerExecutables': { type: 'object', scope: 'machine', description: '%runnerExecutables%',
          default: { c: 'gcc', cpp: 'g++', python: 'python', javascript: 'node', typescript: 'node', java: 'java', javac: 'javac' },
          additionalProperties: { type: 'string', minLength: 1 } },
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
        { command: 'rsh.stopCode', title: '%stopCode%', category: 'RSH', icon: '$(debug-stop)' },
        { command: 'rsh.renameFile', title: '%renameFile%', category: 'RSH' },
        { command: 'rsh.newFile', title: '%newFile%', category: 'RSH', icon: '$(new-file)' },
        { command: 'rsh.return', title: '%returnRsh%', category: 'RSH', icon: '$(arrow-left)' },
        { command: 'rsh.conversation', title: '%conversation%', category: 'RSH', icon: '$(comment-discussion)' },
        { command: 'rsh.newTask', title: '%newTask%', category: 'RSH', icon: '$(add)' },
        { command: 'rsh.coding', title: '%coding%', category: 'RSH', icon: '$(code)' },
        { command: 'rsh.addSelection', title: '%addSelection%', category: 'RSH' },
      ],
      viewsContainers: { secondarySidebar: [{ id: 'rsh-assistant', title: 'RSH', icon: '$(comment-discussion)' }] },
      views: {
        explorer: [{ id: 'rsh.tasks', name: '%tasks%' }],
        'rsh-assistant': [{ id: 'rsh.conversationView', name: '%conversation%', type: 'webview' }],
      },
      menus: {
        'editor/title/context': [{ command: 'rsh.renameFile', when: 'resourceScheme == file || resourceScheme == vscode-remote || resourceScheme == untitled', group: '1_close@0' }],
        'editor/context': [{ command: 'rsh.addSelection', when: 'editorHasSelection', group: 'rsh' }],
        'view/title': [
          { command: 'rsh.newFile', when: 'view == workbench.explorer.fileView', group: 'navigation@0' },
          { command: 'rsh.newTask', when: 'view == rsh.tasks || view == rsh.conversationView', group: 'navigation' },
        ],
        'editor/title': [
          { command: 'rsh.runFile', group: 'navigation@0', when: '!rsh.codeRunning && resourceLangId =~ /^(c|cpp|python|javascript|typescript|java)$/' },
          { command: 'rsh.stopCode', group: 'navigation@0', when: 'rsh.codeRunning' },
          { command: 'rsh.conversation', group: 'navigation@1' },
          { command: 'rsh.coding', group: 'navigation@2' },
        ],
      },
    },
  }
  const xml = '<?xml version="1.0" encoding="utf-8"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="rsh-workbench" Version="0.1.19" Publisher="redspark"/><DisplayName>RedSpark Harness</DisplayName><Description xml:space="preserve">RSH workbench integration</Description><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.100.0"/></Properties></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>'
  const contentTypes = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="cjs" ContentType="application/javascript"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>'
  const bytes = zipSync({
    'extension/package.json': strToU8(JSON.stringify(manifest)),
    'extension/warm-white.json': strToU8(JSON.stringify(ideTheme)),
    'extension/package.nls.json': strToU8(JSON.stringify(workbenchMessages(locale))),
    'extension/package.nls.zh-cn.json': strToU8(JSON.stringify(workbenchMessages('zh'))),
    'extension/run-file.cjs': await readFile(new URL('./ide-run-process.cjs', import.meta.url)),
    'extension/extension.cjs': await readFile(new URL('./ide-extension.cjs', import.meta.url)),
    'extension.vsixmanifest': strToU8(xml), '[Content_Types].xml': strToU8(contentTypes),
  })
  const path = join(directory, 'rsh-workbench.vsix')
  await writeFile(path, bytes, { flag: 'wx' })
  return path
}

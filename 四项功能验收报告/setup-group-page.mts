import { mkdirSync, readFileSync, writeFileSync, existsSync, symlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { ensureShippedNativeProfile, shippedNativeProfileComposition } from '../../RedSparkHarness-tool-groups/rsh/Programs/CLI/src/native-profile-template.ts'

const root = process.cwd()
const home = resolve('output/playwright/tool-groups-home')
ensureShippedNativeProfile('native-web', home)
const profile = join(home, 'profiles/native-web')
const workspace = join(home, 'work')
mkdirSync(workspace, { recursive: true })
const manifests = execFileSync('git', ['ls-files', 'rsh/**/package.json'], { encoding: 'utf8' }).trim().split('\n')
manifests.push('rsh/Modules/Official/guard/tool-groups/package.json')
const packagePaths = new Map<string, string>()
for (const manifest of manifests) {
  const name = JSON.parse(readFileSync(manifest, 'utf8')).name
  packagePaths.set(name, dirname(resolve(manifest)))
  const target = join(profile, 'node_modules', name)
  mkdirSync(dirname(target), { recursive: true })
  if (!existsSync(target)) symlinkSync(dirname(resolve(manifest)), target, 'junction')
}
const mock = join(profile, 'node_modules/tool-groups-offline-model')
mkdirSync(mock, { recursive: true })
writeFileSync(join(mock, 'package.json'), JSON.stringify({ name: 'tool-groups-offline-model', type: 'module',
  exports: { './native': './native.mjs', './package.json': './package.json' },
  dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model', 'modelDirectory'] } } }))
writeFileSync(join(mock, 'native.mjs'), `import { appendFileSync } from 'node:fs';
const info = (provider, id) => ({ provider, id, name: id, inputModalities: ['text'] });
export const plugin = { apiVersion: 1, name: 'tool-groups-offline-model', targets: ['host'], requires: [], provides: ['model','modelDirectory'],
resolve: () => context => {
 context.provide('modelDirectory', { providers: () => [{id:'offline',name:'离线协议验收'}], resolve: async (p,m) => info(p,m),
 catalog: async defaults => ({default:defaults,routableProviders:['offline'],failures:[],groups:[{id:'offline',name:'离线协议验收',models:[{id:'tool-groups',name:'工具组验收（固定响应）'}]}]}) });
 let step = 0;
 context.provide('model', { resolveModel: async (p,m) => info(p,m), async *stream(request) {
  appendFileSync(${JSON.stringify(join(home,'requests.jsonl'))}, JSON.stringify({model:request.model,tools:request.tools})+'\\n');
  step++;
  if (step <= 2) {
    const block = { type:'tool-call', id:'group-ui-'+step, name:step===1?'request_tool_group':'todo_write',
      arguments:JSON.stringify(step===1?{group:'planning'}:{todos:[{content:'核查工具按需开放',status:'completed'}]}) };
    yield {type:'block-start',index:0,blockType:'tool-call'};
    yield {type:'block-end',index:0,block};
    yield {type:'finish',reason:{kind:'tool-calls'}};
  } else {
    const text='离线协议验收完成：先申请 planning 工具组，下一次请求获得 todo_write，再完成清单。本次使用固定模型响应，未调用真实模型。';
    yield {type:'block-start',index:0,blockType:'text'};
    yield {type:'text-delta',index:0,text};
    yield {type:'block-end',index:0,block:{type:'text',text}};
    yield {type:'finish',reason:{kind:'stop'}};
  }
 } });
} };
`)
const shipped = shippedNativeProfileComposition(home, 'native-web')
const app = shipped.installations.find(row => row.id === 'app')!
const rows = [
 ['app','native-web-host',{...app.config as object,port:0}],
 ['sessions','native-web-session-controller',{cwd:workspace,provider:'offline',model:'tool-groups',builtinTools:false,systemPrompt:'This is an offline tool-group protocol acceptance run.',maxSteps:4,maxPendingRequests:8,maxHistoryEvents:1000,maxPromptChars:4000,maxFollowBufferBytes:1000000,maxFollowers:4,maxPendingHumanRequests:2}],
 ['tools','native-tools'],['agents','native-agent'],['model-execution','native-model-execution'],
 ['fs','fs-local',{cwd:workspace}],['storage','session-persistence-jsonl',{root:join(home,'sessions'),compression:'none'}],
 ['credentials','credentials-local',{path:join(home,'credentials.json')}],['todo','tool-todo',{allowParallelInProgress:false}],
 ['groups','tool-groups',{initial:[],groups:[{name:'planning',description:'维护任务清单',tools:['todo_write']}]}],
] as const
const installations = [
 ...rows.map(([id,name,config])=>({id,plugin:'@deepseek-ai/dsh-'+name,scope:'root',...config===undefined?{}:{config}})),
 ...shipped.installations.filter(row=>['session-execution','model-selection'].includes(row.id)),
 {id:'offline-model',plugin:'tool-groups-offline-model',scope:'root'},
]
const ts = createRequire(join(root, 'package.json'))('typescript')
const paths = ts.readConfigFile(join(root, 'tsconfig.base.json'), ts.sys.readFile).config.compilerOptions.paths
for (const row of installations) {
  if (!row.plugin.startsWith('@deepseek-ai/')) continue
  const manifest = JSON.parse(readFileSync(join(packagePaths.get(row.plugin)!, 'package.json'), 'utf8'))
  const source = resolve(paths[row.plugin + '/native'][0])
  const name = 'page-source-' + row.id
  const folder = join(profile, 'node_modules', name)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ ...manifest, name,
    exports: { './native': './native.mjs', './package.json': './package.json' } }))
  writeFileSync(join(folder, 'native.mjs'), `export { ${row.id === 'fs' ? 'localFilesystemPlugin as plugin' : 'plugin'} } from ${JSON.stringify(pathToFileURL(source).href)};`)
  row.plugin = name
}
writeFileSync(join(profile,'rsh.profile.json'),JSON.stringify({formatVersion:1,scopes:[{id:'root'}],installations},null,2))
console.log(home)

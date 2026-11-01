# 四个基础设施包的 Native 定性调查

调查对象：`rsh/Programs/Web/client/{modules,resources,file-upload,hmr}`。
调查方式：只读源码。本次调查**未修改任何代码、未新建除本文件外的文件、未执行 git 操作**。

## 0. 结论速览前的公共事实（先确立，后面各节只引用不重复论证）

Native 侧的清单契约与 Cordis 侧的 `dsh.client` 契约是**两套互不相干的东西**，`modules` 的核心怀疑在这一点上成立：

```
rsh/Core/runtime-diagnostics/native-runtime/src/manifest.ts:5 | export interface NativeEntryManifest {
rsh/Core/runtime-diagnostics/native-runtime/src/manifest.ts:6 |   readonly apiVersion: 1
rsh/Core/runtime-diagnostics/native-runtime/src/manifest.ts:7 |   readonly entry: string
rsh/Core/runtime-diagnostics/native-runtime/src/manifest.ts:8 |   readonly targets: readonly ('host' | 'client')[]
rsh/Core/runtime-diagnostics/native-runtime/src/manifest.ts:14 | const fields = new Set(['apiVersion', 'entry', 'targets', 'requires', 'optional', 'provides'])
rsh/Core/runtime-diagnostics/native-runtime/src/manifest.ts:31 | export function parseNativeEntryManifest(value: unknown, exports: ReadonlySet<string>): NativeEntryManifest {
rsh/Core/runtime-diagnostics/native-runtime/src/manifest.ts:33 |     throw new Error('native-runtime: native manifest must be an object')
```

`parseNativeEntryManifest` 的调用点确认了它取代的是「谁扫描谁组合」这一层职责，而不是替换某个 UI 能力：

```
rsh/Programs/CLI/src/native-profile-loader.ts:352 |     return parseNativeEntryManifest(manifest.dsh.native, new Set(Object.keys(manifest.exports ?? {})))
rsh/Programs/CLI/src/native-profile-loader.ts:378 |         const entry = parseNativeEntryManifest(manifest.dsh.native, new Set(Object.keys(manifest.exports ?? {})))
rsh/Programs/CLI/src/native-profile-loader.ts:408 |       const entry = parseNativeEntryManifest(manifest.dsh?.native, new Set(Object.keys(manifest.exports ?? {})))
rsh/Programs/CLI/src/native-profile-loader.ts:579 |     const plugin = validateNativePluginEntry(imported.plugin, entry)
```

Native 的客户端侧装载是**一次性 esbuild 打包 + 一张具名 plugins 表**，不是 lazy-CJS 模块表，也不是 `__DSH_BOOT__` 行图：

```
rsh/Programs/Web/host/native-web-assets/src/native-client.ts:173 |     const entry = parseNativeEntryManifest(manifest.dsh?.native, new Set(Object.keys(manifest.exports)))
rsh/Programs/Web/host/native-web-assets/src/native-client.ts:222 |   const importRows = entries.map((entry, index) => `import * as plugin${index} from ${JSON.stringify(entry.entryPath)}`)
rsh/Programs/Web/host/native-web-assets/src/native-client.ts:223 |   const pluginRows = entries.map((entry, index) => `${JSON.stringify(entry.id)}: plugin${index}`).join(',')
rsh/Programs/Web/host/native-web-assets/src/native-client.ts:238 |       contents: `${importRows.join('\n')}\nexport const plugins = {${pluginRows}}\n`,
rsh/Programs/Web/host/native-web-assets/src/native-client.ts:291 |   if (cordisInput !== undefined) throw new Error(`dsh native web: native Client bundle imports Cordis through ${cordisInput}`)
```

浏览器侧的装载口只有一个函数式 `import`，由宿主 bundle 的 `plugins` 表实现，**没有**模块表、没有 prefetch、没有 invalidate：

```
rsh/Programs/Web/client/web/src/native-boot.ts:17 | export interface NativeClientModuleSource {
rsh/Programs/Web/client/web/src/native-boot.ts:20 |   import(specifier: string, parentURL: string, attrs: Record<string, unknown>): Promise<unknown>
rsh/Programs/Web/client/web/src/native-boot.ts:102 |         const exports = await modules.import(selection.id, '', {})
rsh/Programs/Web/application/src/native-entry.ts:151 |       modules: { manifest: { modules: wire.modules }, import: (specifier) => {
rsh/Programs/Web/application/src/native-entry.ts:152 |         const entry = bundle[specifier]
```

由此得到一个贯穿全文的判据：**一个包如果只在该清单里声明了 `dsh.client` 而没有 `dsh.native`，把它写进 `rsh.client.json` 会在构图阶段直接失败**——`native-client.ts:173` 传进去的 `manifest.dsh?.native` 是 `undefined`，`manifest.ts:32-34` 立刻抛 `native manifest must be an object`。四个包全部处于这个状态（见各节 `package.json` 引用）。

唯一的例外通道是 `rsh/Scripts/native-package-policy.ts` 的两个白名单，它们描述的是**编译面**而非装配面：

```
rsh/Scripts/native-package-policy.ts:252 | /** Mixed library exports that have native values or types but no installer manifest. */
rsh/Scripts/native-package-policy.ts:270 |   ['rsh/Programs/Web/client/modules', ['client']],
```

四个包中只有 `modules` 出现在这两个白名单里（`resources`、`file-upload`、`hmr` 在整份 policy 文件中零命中，实测 grep 无结果）。

---

## 1. `modules` —— 结论 ③ 部分保留（保留 `./native` 浏览器半，弃 Node 半与 `./client` 引导面）

### 1.1 它声明的是什么

```
rsh/Programs/Web/client/modules/package.json:36 |   "dsh": {
rsh/Programs/Web/client/modules/package.json:37 |     "client": {
rsh/Programs/Web/client/modules/package.json:38 |       "platform": "web",
rsh/Programs/Web/client/modules/package.json:39 |       "inject": [],
rsh/Programs/Web/client/modules/package.json:40 |       "immediately": true
```

只有 `dsh.client`，没有 `dsh.native`。但它导出了第五个入口：

```
rsh/Programs/Web/client/modules/package.json:25 |     "./native": {
rsh/Programs/Web/client/modules/package.json:26 |       "types": "./lib/types/client/native.d.ts",
rsh/Programs/Web/client/modules/package.json:27 |       "default": "./lib/native.js"
rsh/Programs/Web/client/modules/src/client/native.ts:1 | /** Cordis-free browser module table and boot-graph parser for native Client composition. */
rsh/Programs/Web/client/modules/src/client/native.ts:2 | export { ClientModuleSystem } from './system.ts'
```

所以这个包是「三面」而不是「双面」：Node 半（组合 `__DSH_BOOT__`）、`./client` 浏览器半（Cordis 引导面）、`./native` 浏览器半（无 Cordis 的模块表）。

### 1.2 Node 半的职责已被谁取代

Node 半的核心是扫描宿主 Loader 的 entry，组合 `window.__DSH_BOOT__`，并在 `/plugins` 下提供 bundle 路由：

```
rsh/Programs/Web/client/modules/src/index.ts:3 |  * the host Loader's entries for packages declaring `dsh.client`, composes the
rsh/Programs/Web/client/modules/src/index.ts:4 |  * `window.__DSH_BOOT__` entry graph (wire single source: {@link WebBootEntry}
rsh/Programs/Web/client/modules/src/index.ts:476 |   rows.push({ kind: 'global', name: '__DSH_BOOT__', value: graph })
rsh/Programs/Web/client/modules/src/index.ts:487 | export class ClientModuleRegistry extends Service {
rsh/Programs/Web/client/modules/src/index.ts:488 |   static inject = ['loader']
rsh/Programs/Web/client/modules/src/index.ts:32 | import { Service } from '@deepseek-ai/cordis'
```

`ClientModuleRegistry` 是 Cordis `Service` 且 `inject = ['loader']`——它从 vendored Cordis Loader 的 entry 树里发现客户端包。Native 没有 Loader entry 树这个概念：包来自 `rsh.client.json` 的行，经 `parseNativeEntryManifest` 校验（`native-client.ts:173`），再由 esbuild 打成单一 ESM bundle（`native-client.ts:222-238`），由 `native-web-host` 以 `/.dsh/native-client/` 前缀提供资产。**构图、校验、路由、打包四件事都有了对应的 Native 实现**，`__DSH_BOOT__` 这个全局量在 Native 路径上完全不存在（`native-wire.ts` 的载荷字段是 `bundle` / `styles` / `modules` / `selections`，没有 entry 图）。

### 1.3 `./client` 浏览器半为何不能移植

```
rsh/Programs/Web/client/modules/src/client/index.ts:65 | export function apply(ctx: Context): void {
rsh/Programs/Web/client/modules/src/client/index.ts:69 |   ctx.reflect.provide('modules', moduleSystem)
rsh/Programs/Web/client/modules/src/client/index.ts:13 | import type { Context } from '@deepseek-ai/cordis'
rsh/Programs/Web/client/modules/src/client/index.ts:20 | declare module '@deepseek-ai/cordis' {
```

它的入口本身就是一个 Cordis 插件（`apply` + `ctx.reflect.provide`），并对 `@deepseek-ai/cordis` 做 declaration merge。`native-client.ts:291` 明确禁止 Native bundle 里出现 Cordis——这一半在 Native 下不但多余，还是构建期硬错误。

### 1.4 保留哪部分

`./native` 是零 Cordis、零工作区依赖的浏览器模块表与启动清单解析器：

```
rsh/Programs/Web/client/modules/README.md:32 | The browser-only `@deepseek-ai/dsh-client-modules/native` export provides `ClientModuleSystem`, boot-manifest parsing, and their types without importing Cordis. Its JavaScript and public declarations have no workspace package imports; the Cordis peer is optional for this export. It does not activate a plugin tree or replace the current `./client` bootstrap; a native shell must supply its own plugin installation and renderer handoff.
rsh/Programs/Web/client/modules/src/client/system.ts:61 | export class ClientModuleSystem implements ClientModuleLoader {
```

policy 也把它登记为「有 native 值但无 installer manifest」（`native-package-policy.ts:270`）。

**必须点明的保留理由的限度**：这个 `./native` 面在**生产代码里当前没有 Native 消费者**。搜索 `ClientModuleSystem` 的引用，除本包自身与 `web` 包的测试/e2e 之外没有第三方：

```
rsh/Programs/Web/client/web/tests/native-boot.client.spec.ts:2 | import { ClientModuleSystem, parseBootManifest, type ClientModuleLoaderTarget, type WebBootGraph } from '@deepseek-ai/dsh-client-modules/native'
rsh/Programs/Web/client/web/tests/built-native-consumer.e2e.ts:113 |         import { ClientModuleSystem } from '@deepseek-ai/dsh-client-modules/native'
```

而真正的 Native 启动路径（`native-boot.ts:102`、`native-entry.ts:151`）用的是自己构造的 `import` 闭包，**没有**实例化 `ClientModuleSystem`。因此「保留」是指「暂不删除、等待其是否成为 Native 第二装载实现的决定」，不是「Native 现在需要它」。

### 1.5 对 Native 装配的影响

不加入 `rsh.client.json`。若强行加入，`native-client.ts:173` + `manifest.ts:32-34` 会在构图阶段报 `native manifest must be an object`。`modules` 是否最终删除取决于 1.4 那个悬置决定，属于另一件事。

---

## 2. `resources` —— 结论 ② Cordis 专属，应当排除

### 2.1 它声明的是什么

```
rsh/Programs/Web/client/resources/package.json:28 |   "dsh": {
rsh/Programs/Web/client/resources/package.json:29 |     "client": {
rsh/Programs/Web/client/resources/package.json:30 |       "inject": [
rsh/Programs/Web/client/resources/package.json:31 |         "@deepseek-ai/dsh-client-ui-renderer"
rsh/Programs/Web/client/resources/package.json:32 |       ],
rsh/Programs/Web/client/resources/package.json:33 |       "platform": "web"
```

只有 `dsh.client`，没有 `dsh.native`，也没有 `./native` 子路径（`exports` 只有 `.` 与 `./client`，见 `package.json:16-27`）。

### 2.2 它的三根支柱全部长在 Cordis 上

```
rsh/Programs/Web/client/resources/src/client/index.ts:23 | export const inject = ['slots']
rsh/Programs/Web/client/resources/src/client/index.ts:33 |   const resources = new ResourceRegistry(ctx)
rsh/Programs/Web/client/resources/src/client/index.ts:34 |   const disposeService = ctx.reflect.provide('resources', resources)
rsh/Programs/Web/client/resources/src/client/index.ts:38 |   ctx.slots.provideRoot({
rsh/Programs/Web/client/resources/src/client/index.ts:39 |     keyedHooks: { resource: address => resources.source(address) },
rsh/Programs/Web/client/resources/src/client/resources.ts:80 |   constructor(private readonly ctx: Context) {}
rsh/Programs/Web/client/resources/src/client/resources.ts:88 |     const dispose = this.ctx.effect(() => {
```

`ctx.reflect.provide`、`ctx.slots`、`ctx.effect` 三个都是 Cordis Context 成员；`ResourceRegistry` 把 `ctx` 存进构造函数只为了调 `ctx.effect` 挂注册生命周期。

契约面同样对 `@deepseek-ai/cordis` 做 declaration merge，并把 `useResource` 塞进 `GlobalStandardProps`：

```
rsh/Programs/Web/client/resources/src/client/contract.ts:21 | declare module '@deepseek-ai/dsh-client-ui-slots' {
rsh/Programs/Web/client/resources/src/client/contract.ts:24 |     useResource: UseResource
rsh/Programs/Web/client/resources/src/client/contract.ts:28 | declare module '@deepseek-ai/cordis' {
rsh/Programs/Web/client/resources/src/client/contract.ts:31 |     resources: Resources
```

### 2.3 谁取代了它

**职责被替换，不是被新包替换**。Native 的文件面板不经由「地址 → 活值」这层抽象，而是直接调 Session 客户端服务：

```
rsh/Programs/Web/client/ui-sidebar-right/package.json:56 |       "optional": [
rsh/Programs/Web/client/ui-sidebar-right/package.json:57 |         "clientNativeWorkspaceFiles"
rsh/Programs/Web/client/ui-sidebar-right/src/native-ui.tsx:235 |     const workspaceFiles = context.optional('clientNativeWorkspaceFiles')
rsh/Programs/Web/client/native-session/src/native.ts:89 |     clientNativeWorkspaceFiles: NativeWorkspaceFilesClient
rsh/Programs/Web/client/native-session/src/native.ts:146 |   list(sessionId: SessionId, path: string, signal?: AbortSignal): Promise<WorkspaceDirectoryListing>
```

`NativeWorkspaceFilesClient` 直接给 `list/stat/follow/read/readAll/readRelated`，把「地址」降级成「sessionId + workspace 相对路径」，因此 `dsh-resource://` 的协议注册、`pin`、`subscribe`/`holders` 计数这一整套需求在 Native 侧根本不出现。

**地址语法本身没有消失**，它作为纯字符串语法留在一个无 Cordis 的包里，被 Native 侧的类型引用：

```
rsh/Core/util/workspace-path/src/file-address.ts:42 | const FILE_ADDRESS_PREFIX = 'dsh-resource://file/'
rsh/Programs/Web/api/workspace-files/src/types.ts:9 |  *   resource system, whose `dsh-resource://file/session/<id>/<path>` address carries that
```

也就是说：**语法保留，运行时服务不需要**。

### 2.4 唯一的生产消费者是 Cordis 的

```
rsh/Programs/Web/api/workspace-files/src/client/index.ts:17 | export const inject = ['resources', 'remote', 'remote.workspaceFiles']
rsh/Programs/Web/api/workspace-files/src/client/index.ts:27 |     const release = ctx.resources.register(provider)
```

`file` 协议的唯一 provider 是 `ctx.resources.register`，注册在 Cordis 上下文里；这个包也没有 `dsh.native`（其 `dsh` 字段只有 `client`，见该包 `package.json`）。整条链在 Native 下都不存在。

### 2.5 对 Native 装配的影响

不加入 `rsh.client.json`，理由同 1.5（缺 `dsh.native` 会在构图期被拒）。若将来移植 `ui-sidebar-documentpreview`（当前唯一在渲染路径上使用 `useResource<'file'>` 的包，见 `ui-sidebar-documentpreview/src/client/TextPreview.tsx:60`），需要重新评估——那时要的不是移植本包，而是把 `clientNativeWorkspaceFiles` 接进该面板。

---

## 3. `file-upload` —— 结论 ② Cordis 专属，应当排除

### 3.1 它声明的是什么

```
rsh/Programs/Web/client/file-upload/package.json:40 |   "dsh": {
rsh/Programs/Web/client/file-upload/package.json:41 |     "client": {
rsh/Programs/Web/client/file-upload/package.json:42 |       "inject": [
rsh/Programs/Web/client/file-upload/package.json:43 |         "@deepseek-ai/dsh-api-remotes"
rsh/Programs/Web/client/file-upload/package.json:46 |       "immediately": true
```

只有 `dsh.client`，无 `dsh.native`。

### 3.2 Host 半：被 `native-web-session-controller` 完整取代

Host 半是一个 Cordis 服务，注册 `/api/session/uploadFileBinary` 流式路由：

```
rsh/Programs/Web/client/file-upload/src/index.ts:18 | declare module '@deepseek-ai/cordis' {
rsh/Programs/Web/client/file-upload/src/index.ts:21 |     fileUploads: FileUploads
rsh/Programs/Web/client/file-upload/src/index.ts:57 | export class FileUploads extends TypertRemoteService {
rsh/Programs/Web/client/file-upload/src/index.ts:58 |   static inject = ['agents', 'attachments', 'commands', 'connection']
rsh/Programs/Web/client/file-upload/src/index.ts:73 |     () => ctx.connection.fetch.register({
rsh/Programs/Web/client/file-upload/src/index.ts:74 |         path: FILE_UPLOAD_PATH,
rsh/Programs/Web/client/file-upload/src/protocol.ts:2 | export const FILE_UPLOAD_PATH = '/api/session/uploadFileBinary'
```

Native 侧对应的路由与服务是另一套，并且**不复用本包**：

```
rsh/Programs/Web/api/native-web-session-controller/src/native.ts:2411 |       context.own(context.require('hostConnection').fetch.register({ path: '/api/native-session/file-upload', methods: ['POST'], requestBody: 'streaming',
rsh/Programs/Web/api/native-web-session-controller/src/native.ts:697 |         return this.executor.rootExecution.stagedFiles.stageStream({ route, id,
rsh/Engine/core/native-session-execution/src/root-execution.ts:40 | export interface NativeRootStagedFileOperations {
rsh/Engine/core/native-session-execution/src/root-execution.ts:46 |   stageStream(request: {
```

路径不同（`/api/native-session/file-upload` vs `/api/session/uploadFileBinary`）、收据所有权不同（`NativeRootStagedFileOperations` vs `FileUploads.stagedFiles` WeakMap）。**这是一次平行重写，不是包装**。

### 3.3 浏览器半：被 `clientNativeSession.uploadFile` 取代，且保留了同一个 pre-Cordis 钩子

浏览器半是 Cordis `Service`，并提供一个后台 Worker 传输：

```
rsh/Programs/Web/client/file-upload/src/client/index.ts:18 | export const inject = ['remote']
rsh/Programs/Web/client/file-upload/src/client/runtime.ts:162 | export class FileUploadRuntime extends Service implements FileUploadService {
rsh/Programs/Web/client/file-upload/src/client/runtime.ts:169 |     const hook = (globalThis as ClientFileUploadGlobal).__DSH_FILE_UPLOAD__
rsh/Programs/Web/client/file-upload/src/client/runtime.ts:171 |     this.transport = hook === undefined ? workerTransport() : customTransport(hook.fetch)
```

Native 的等价能力在 `clientNativeSession` 里，**直接读同一个全局钩子，并自带 Fetch 流式兜底**：

```
rsh/Programs/Web/client/native-session/src/native.ts:70 |   __DSH_FILE_UPLOAD__?: { readonly fetch: (input: URL, init: RequestInit) => Promise<Response> }
rsh/Programs/Web/client/native-session/src/native.ts:1773 |         const uploadFetch = (globalThis as NativeFileUploadGlobal).__DSH_FILE_UPLOAD__?.fetch
rsh/Programs/Web/client/native-session/src/native.ts:1778 |           const responseOperation = rpc.response
rsh/Programs/Web/client/native-session/src/native.ts:1779 |           if (responseOperation === undefined) throw new Error('native Session Client: selected carrier has no streaming Fetch operation')
```

结论：Worker 后台传输这一层在 Native 下不需要——Native 用连接载体的 streaming Fetch 操作直接以 `duplex: 'half'` 发流（`native.ts:1778-1780`）。`__DSH_FILE_UPLOAD__` 这个**发布点**（`webworker-runtime`，`Modules/Community/experimental/webworker-runtime/src/client/index.ts:160-162`）与 Native 的**消费点**（`native.ts:1771`）是直接对接的，中间不需要本包。

### 3.4 一个必须写清的区分

本包还提供了 `ctx.fileUpload.upload()` 给 `ui-conversation` 使用：

```
rsh/Programs/Web/client/ui-conversation/src/client/apply.ts:41 | export const inject = [
rsh/Programs/Web/client/ui-conversation/src/client/apply.ts:42 |   'slots', 'sessions', 'fileUpload', 'uiSession', 'uiWorkspace', 'locale', 'settingsScope',
rsh/Programs/Web/client/ui-conversation/src/client/service.ts:366 |         const result = await this.ctx.fileUpload.upload(
```

但 `ui-conversation` **没有 Native 移植**（实测 `rsh/Programs/Web/client` 下带 `dsh.native` 的客户端包共 13 个：`connection`、`locale`、`native-application`、`native-session`、`ui-brand-official`、`ui-input-trigger`、`ui-layout`、`ui-open-in-app`、`ui-renderer`、`ui-session`、`ui-sidebar`、`ui-sidebar-right`、`ui-theme`，其中不含 `ui-conversation`）。Native 的输入面是 `native-application` 里的 `send()`，上传走 `NativeSessionClient.uploadFile`：

```
rsh/Programs/Web/client/native-application/src/controller.ts:685 |         if (files.length > 0) {
rsh/Programs/Web/client/native-application/src/controller.ts:707 |               else reader.readAsDataURL(file)
rsh/Programs/Web/client/native-application/src/controller.ts:710 |             images.push({ mediaType, data, name: file.name })
```

所以「`ui-conversation` 需要它」是 Cordis 侧的事实，不构成 Native 需要它的理由。

### 3.5 对 Native 装配的影响

不加入 `rsh.client.json`（缺 `dsh.native`，构图期被拒）。注意**不能连带删除 Host 侧的 `FileUploads`**——它仍是 Cordis Web 应用的活路径（`session-controller/src/index.ts:125` 调 `ctx.fileUploads.registerAgentResolver`）。本节的「排除」仅指「不把它搬进 Native」。

---

## 4. `hmr` —— 结论 ② Cordis 专属，应当排除（Native 已有不同设计的等价机制）

### 4.1 它声明的是什么

```
rsh/Programs/Web/client/hmr/package.json:32 |   "dsh": {
rsh/Programs/Web/client/hmr/package.json:33 |     "client": {
rsh/Programs/Web/client/hmr/package.json:34 |       "inject": [
rsh/Programs/Web/client/hmr/package.json:35 |         "@deepseek-ai/dsh-client-modules"
rsh/Programs/Web/client/hmr/package.json:36 |       ],
```

只有 `dsh.client`，无 `dsh.native`。它的 `inject` 直接点名了 `modules`——两个包是同一套机制的上下半。

### 4.2 两半都依赖 Cordis 的入口树

Node 半靠 `clientModules` 与 `webServer`，靠 `ctx.clientModules.rebuilt(id)` 触发重载：

```
rsh/Programs/Web/client/hmr/src/index.ts:28 | export const inject = ['clientModules', 'webServer']
rsh/Programs/Web/client/hmr/src/index.ts:79 |       ctx.clientModules.rebuilt(id)
rsh/Programs/Web/client/hmr/src/index.ts:130 |     for (const row of ctx.clientModules.graph().entries) {
```

浏览器半靠 vendored Cordis Loader 的 entry 做 fiber 就地替换：

```
rsh/Programs/Web/client/hmr/src/client/index.ts:77 | export const inject = ['loader', 'modules']
rsh/Programs/Web/client/hmr/src/client/index.ts:88 | export async function tearDownEntryFiber(entry: Entry): Promise<void> {
rsh/Programs/Web/client/hmr/src/client/index.ts:92 |   if (runtime !== null) entry.ctx.registry.delete(runtime.callback)
rsh/Programs/Web/client/hmr/src/client/index.ts:134 |     modLoader.invalidate(id, rev)
rsh/Programs/Web/client/hmr/src/client/index.ts:145 |     await entry.refresh()
```

`entry.refresh()`、`entry.ctx.registry.delete`、`modLoader.invalidate/prefetch` 全部是 vendored Loader 与 lazy-CJS 模块表的 API。Native 既无 entry 树也无 lazy-CJS 表（见第 0 节），这条链路在 Native 下没有落点。

### 4.3 取代它的是 `native-web-host` 的 `clientReload: 'live'`

设计完全不同：不是「替换一个插件的 fiber」，而是「重新打包整张图 → 原子发布 → 浏览器轮询 revision → `host.replace()`」。宿主侧：

```
rsh/Programs/Web/host/native-web-host/src/client-reload.ts:39 |     const watcher = watch([...directories], { ignoreInitial: true, persistent: false, depth: 0, followSymlinks: false })
rsh/Programs/Web/host/native-web-host/src/client-reload.ts:44 |     watcher.on('all', () => { void this.refresh() })
rsh/Programs/Web/host/native-web-host/src/native.ts:81 |     const clientReload = fields.clientReload ?? 'startup'
rsh/Programs/Web/host/native-web-host/src/native.ts:148 |       const routeDisposer = config.clientReload === 'live'
rsh/Programs/Web/host/native-web-host/src/native.ts:169 |             if (nextRevision === revision) return
```

浏览器侧对应的是客户端轮询而非 SSE push：

```
rsh/Programs/Web/application/src/native-entry.ts:126 |       const timer = window.setTimeout(resolve, 500)
rsh/Programs/Web/application/src/native-entry.ts:129 |     const response = await fetch(initial.reload.endpoint, { headers: { accept: 'application/json' }, signal })
rsh/Programs/Web/application/src/native-entry.ts:150 |     await host.replace({
```

文件监视用 chokidar 而非 stat 轮询（对比本包 `src/index.ts:149` 的 `setInterval(pollWatches, ...)`），通信是 revision 轮询而非 `/plugins/events` SSE（对比 `src/index.ts:176` 的 `ctx.webServer.register`）。

### 4.4 一个诚实的限定

本包是**开发期机制**，生产图里本来就不含它（`Docs/subsystems/client-modules.md:103`：「Production graphs omit the HMR row entirely」）。因此「排除」不减少任何发布能力；它只是确认：**不要为了「让 Native 也有热更新」去移植它**——`clientReload: 'live'` 已经提供了同目的、不同形状的能力。

### 4.5 对 Native 装配的影响

不加入 `rsh.client.json`（缺 `dsh.native`）。开发期热更新走 `clientReload: 'live'`。

---

## 5. 总结表

| 包 | 结论 | 关键依据行号 | 对 Native 装配的影响 |
|---|---|---|---|
| `modules` | ③ 部分保留：保留 `./native` 浏览器半（`ClientModuleSystem` + 启动清单解析器），弃 Node 半与 `./client` 引导面 | `package.json:25-28`（`./native` 导出）、`package.json:36-42`（只有 `dsh.client`）、`src/index.ts:476`（`__DSH_BOOT__` 行）、`src/index.ts:487-488`（Cordis `Service` + `inject ['loader']`）、`src/client/index.ts:65-69`（Cordis 插件面）、`src/client/native.ts:1-2`（零 Cordis 面）、`native-client.ts:173/222-238/291`（取代者）、`native-package-policy.ts:270`（已登记为 native 值库） | 不进 `rsh.client.json`。强加会在构图期抛 `native manifest must be an object`。保留部分当前无生产消费者 |
| `resources` | ② Cordis 专属，应当排除 | `package.json:28-34`（只有 `dsh.client`，无 `./native`）、`src/client/index.ts:23/34/38`（`inject ['slots']`、`ctx.reflect.provide`、`ctx.slots.provideRoot`）、`src/client/resources.ts:80/88`（`ctx.effect`）、`src/client/contract.ts:24/28-30`（declaration merge 到 `ui-slots` 与 `cordis`）、`native-session/src/native.ts:89/146`（取代者）、`workspace-files/src/client/index.ts:17/27`（唯一 provider 走 Cordis） | 不进 `rsh.client.json`。`dsh-resource://` 语法保留在 `Core/util/workspace-path`，运行时服务不需要 |
| `file-upload` | ② Cordis 专属，应当排除 | `package.json:40-47`（只有 `dsh.client`）、`src/index.ts:18-21/57-58/73-74`（Cordis `Service` + Typert Remote + `/api/session/uploadFileBinary`）、`src/client/runtime.ts:162/169-171`（Cordis `Service` + Worker 传输）、`native-web-session-controller/src/native.ts:2411/697`（取代者，另一条路径）、`root-execution.ts:40/46`（Native 收据操作）、`native-session/src/native.ts:1773/1778-1782`（浏览器半取代者） | 不进 `rsh.client.json`。但不能连带删除 Host 侧 `FileUploads`——Cordis Web 仍是活路径（`session-controller/src/index.ts:125`） |
| `hmr` | ② Cordis 专属，应当排除 | `package.json:32-39`（只有 `dsh.client`，inject `client-modules`）、`src/index.ts:28/79/130`（`clientModules` + `webServer`）、`src/client/index.ts:77/88/134/145`（`loader` + `modules`，`entry.refresh()`）、`native-web-host/src/client-reload.ts:39/44`（取代者，chokidar）、`native-web-host/src/native.ts:81/148/169`（`clientReload: 'live'`）、`native-entry.ts:126-129/150`（revision 轮询 + `host.replace`） | 不进 `rsh.client.json`。开发期热更新走 `clientReload: 'live'`，不要为 Native 另造 HMR |

## 6. 核心怀疑的判定

**证实。** Native 用 `dsh.native` 清单 + `parseNativeEntryManifest`（`manifest.ts:31`，调用点 `native-profile-loader.ts:352/378/408` 与 `native-client.ts:173`）取代了 `modules` 的职责，且取代范围比「清单校验」更宽——它连资产路由（`/.dsh/native-client/`）与打包（esbuild 单 bundle，`native-client.ts:238`）一起接管，并在构建期主动拒绝 Cordis（`native-client.ts:291`）。

**但不能据此推出「`modules` 整个包都不该留」**：该包的 `./native` 子路径本来就不含 Cordis（`src/client/native.ts:1-2`），且已被仓库的 native policy 登记为有 native 值的库（`native-package-policy.ts:270`）。准确地说是：**`modules` 的 Cordis 专属部分应排除；它剩下的无 Cordis 面在 Native 下当前无人使用，去留是另一个决定**。

---

## 7. 调查中未读到 / 未能确定的地方（不用推断填补）

1. **`modules/./native` 是否有未来的 Native 用途**：我只确认了它现在在生产代码中零消费者（引用仅见 `web/tests/native-boot.client.spec.ts:2` 与 `web/tests/built-native-consumer.e2e.ts:113`）。仓库没有任何文档说明它是否为 Native 的预备装载器。我读到 `README.md:32` 为止，该句只说「不激活插件树、不替换 `./client` 引导」，没有给出计划。

2. **`resources` 若被移植的可行性**：Native 的 `SlotRuntime` 确实有 `provideRoot`（`ui-renderer/src/slot-runtime.ts:257`，原生 `clientSlots` 服务），而且 `ui-slots` 的 `ResourceProtocolMap` 是空接口合并点（`ui-slots/src/index.ts:44`），从类型上看可以在 Native 侧重新声明。但我**没有**验证 `keyedHooks` 在 Native 的 `provideRoot` 实现里是否被真正消费到渲染（`slot-runtime.ts:471-479` 只读到赋值，未追踪到 `scoped-slots.tsx:358` 之后的渲染路径）。所以本节只断言「现在不需要」，不断言「将来不能做」。

3. **`hmr` 的 `/plugins/events` 在 Native 下是否有残留消费者**：我未搜索 Native 包对该端点的引用。基于 `native-client.ts:291` 与 `native-entry.ts` 的 revision 轮询设计，我认为没有，但**未逐包核验**，故不作为结论依据。

4. 报告写作过程中一次 `Get-ChildItem -Recurse` 扫到 `node_modules` 深层符号链接并失败（已终止该后台任务）。这不影响任何结论——所有引用的行号均来自已成功读取的文件。

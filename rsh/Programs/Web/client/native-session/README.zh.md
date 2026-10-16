---
description: "原生 Web Session 生命周期的共享执行与浏览器传输。"
kind: "package-reference"
---

# 原生浏览器 Session

[English](README.md) | 中文

## 概述

该不依赖 Cordis 的 Client Consumer 通过选定的 Connection RPC Provider 提供原生 Web Session 生命周期。

原生 profile 通过 `dsh.native` 行及 `./native` 导出选择本包；旧 `dsh.client` 模块表不会加载它。生产依赖包含已发布声明引用的包，但安装这些包不会激活其 NativePlugin；profile 仍必须显式选择所需的 Connection Provider。包选择与声明依赖的决策记录在[安装说明](../../../../../.agents/notes/implemented/architecture/2026-10-06-native-web-profile-installation.zh.md)中。

## 目录

- [参考](#reference)
- [不变量](#invariants)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)
- [模型体验](#model-experience)

<a id="reference"></a>
## 参考

在原生 profile 中选择本包时，必须排在 client-connection 后，并配置正整数 maxFollowBufferChars，以限制 SSE 解析缓冲区。clientNativeSession 服务提供 list、create、history、prompt、attach、cancel 与 status。提示要求显式 resume 布尔值；attach 会从调用方最后的持久事件序号恢复活动轮次，并重放待处理的人类展示。两种操作都会等待 Host 结算。prompt 或 attach 的轮次信号会显式取消执行；detach 信号只停止本地跟随和结算等待，不会取消 Host 轮次。Host 错误以拒绝返回；解码结果在进入 Consumer 前验证端点字段。Consumer 不维护第二个 Session 缓存或连接循环。

`./list-types` 导出 Host 与 Client 共用的纯 Session 列表 wire row。标题投影与未修改的 Session header 并列，区分已解析、不存在和读取不可用；Host 从持久标题事件生成该投影。

`list()` 返回按 `updatedAt` 降序排列的列表项，包含空白、运行、完成、待交互、直接子项数量、已确认工作区及定时任务字段。`follow(signal)` 通过经过身份验证的 Fetch 载体先发送完整基线，再发送合并后的 upsert 与 remove 帧。即使 Consumer 暂停在已产出的帧上，中止 `signal` 也会结束跟随并释放 `close()`。`search(query, cursor?, signal?)` 返回有界的标题或当前消息匹配、可选片段及续页 cursor；`archive(sessionId, signal?)` 通过 Host Workspace 注册表归档 Session。

`executeCommand(sessionId, line, signal?)` 通过经过身份认证的 `session/command` RPC 发送一条完整斜杠命令，并返回其 `CommandExecution`。Host 负责命令查找、空闲 Session 检查以及在确切 root owner 上分派；取消会等待 Host 结算。Client 不增加第二个命令注册表或执行路径。

`commands(sessionId, signal?)` 通过 `session/commands` 读取所选 Session 的命令描述符，包括各命令可选的输入提示和附件支持信息。Client 会验证 Host 响应，且不缓存命令目录。

模型控件解码选定 Host 的目录与已安装预设元数据。模型与预设修改必须携带所呈现的持久化修订号，并在 Host 维护操作结算后完成。目录不限制显式模型路由；模型 Provider 验证解析。这些方法不拥有选择缓存。

`modeControls(sessionId, signal?)` 会读取当前 agent preset、已安装选项、持久化修订号与空白 Session 锁定状态。模式变更通过携带该修订号的 `selectPreset` 完成。同一响应还包含 plan mode 的可用性及当前或待应用状态；`selectPlanMode(sessionId, active, signal?)` 返回 Host 状态机的 `committed`、`queued`、`cancelled` 或 `noop` 结果。

`permissionControls(sessionId, signal?)` 返回有效的常驻权限策略与已配置选项。`selectPermissionPreset(sessionId, preset, signal?)` 通过 Host 的确切 Session owner 持久化该选择；它不会回答待处理的一次性审批请求。未安装 permission Provider 时，读取结果为 `available: false`、`currentValue: null` 和空选项。

`agentPresetsList(signal?)` 调用 `agent-presets/list` 并校验 Host 返回的 `{ default, presets }`。它同时包含 profile 独有的常驻组合和扫描到的原生目录；目录提供信任级别时，`source` 为 `system` 或 `user`，否则为 `profile`。Host 未安装 Registry 时返回 `default: null` 和空列表。

`agentPresetRead(id, signal?)` 返回 preset 来源、状态、元数据与原生组装文件文本；profile 独有的行没有文件内容。`agentPresetCopy(from, id, name?, signal?)` 将文件 preset 复制到 Host 用户目录；`agentPresetDelete(id, signal?)` 只删除用户 preset。`agentPresetsCanOpenDirectory(signal?)` 报告 Host 打开器是否可用；`agentPresetOpenDirectory(id, signal?)` 打开用户目录，或返回 Host 本地路径。这五个方法都通过 `NativeSessionRpcError` 保留 Host 拒绝码。

可选提示观察者通过选定 Connection 的 Fetch 响应跟随已接受的持久化事件及临时助手文本。维护中的 eventsource-parser 处理 SSE 分帧。事件解码复用共享 Session 解析器；缺少结算终止帧、帧格式错误或观察者失败都会取消确切准入，并等待 Host 排空后拒绝。调用方取消会解除跟随，仍等待持久化结算。没有 response 支持的自定义 RPC 载体在准入前拒绝带观察者的提示。

`answerHuman(sessionId, id, { kind: 'cancel-questions' })` 通过既有 `session/answer-human` RPC 只取消该待答问题。Host 在以 `ASK_CANCELLED` 拒绝 Provider 等待前，检查经过身份认证的 Session、当前准入、根所有者与展示。工具错误进入下一模型 step，而不取消整轮；其他待答问题仍可回答。重复或迟到答案会被拒绝。

同一 Consumer 通过选定的 `/api` 载体提供 `settingsDescribe`、带 revision 检查的 `settingsMutate`、`credentialsDescribe`、`credentialsSet` 与 `credentialsUnset`。当 `settingsDescribe` 报告 `hasDocument` 时，`settingsOpenDocument` 会打开 Host 的本地设置文档。`pluginInventoryList` 为插件页读取 Host 安装列表，`modelCatalog` 经 `session/model-controls` 返回 Host 模型目录（或 null）。`settingsDescribe` 返回已发布的 namespace descriptor 和所选 Host 提供的请求预算。Settings 页面依照 `maxCredentialRefsPerRead` 分批读取并聚合凭据结果；超过 `maxSettingsOperations` 的修改会在发送前拒绝，因为一次 revision 检查写入必须保持原子性。Host 将这些经过校验的限制默认为 64 个凭据引用和 512 个操作。凭据读取只返回是否存在、来源与可写性事实，凭据写入返回确认且不回显值。`NativeSessionRpcError` 保留 Host 错误码与冲突详情以便处理过期写入。

`modelsListProviders`、`modelsListConfigurableProviders` 与 `modelsDiscover` 会读取 Host 的活动路由、可配置 Provider 诊断及草稿发现结果。`NativeModelDiscoveryRequest.apiKey` 只随单次发现请求发送；Host 失败会以 `NativeSessionRpcError` 拒绝。`settingsEvents(signal)` 流式接收不含值的 `settings/document-updated`、`credentials/reference-updated`、`llm/adapters-updated`、`agent-presets/updated` 与 `accounts/changed` 通知；取消信号会正常结束迭代。

```ts type-equiv
/** Native preset metadata and optional raw composition file returned by the Host. */
interface NativeAgentPresetDocument {
  /** Preset id. */
  readonly id: string
  /** Profile-only, shipped or user-authored source. */
  readonly source: 'profile' | 'system' | 'user'
  /** Composition file status. */
  readonly status: 'ready' | 'needs-migration' | 'invalid'
  /** Display name. */
  readonly name: string
  /** Optional display description. */
  readonly description?: string
  /** Raw `agent.native.json` text when the folder has a composition file. */
  readonly content?: string
  /** Short reason when the folder cannot be installed. */
  readonly problem?: string
}
```

```ts type-equiv
/** Notification-only event that tells Settings pages which view to reread. */
type NativeSettingsEvent =
  | { readonly type: 'settings/document-updated'; readonly namespace: string; readonly revision: number }
  | { readonly type: 'credentials/reference-updated'; readonly ref: string }
  | { readonly type: 'llm/adapters-updated' }
  | { readonly type: 'agent-presets/updated' }
  | { readonly type: 'accounts/changed'; readonly key: string }
```

授权方法会列出安全的流程信息、开始尝试、从授权 Fetch 路由接收可重放且不含机密的帧，并使用当前尝试标识提交回答、拒绝或取消。

账户方法会列出 Host 投影的安全身份、读取 Provider 用量，并按账户 key 退出登录。身份中的 email、name 和头像 URL 均可为空；用量状态区分 ready、signed-out、failed 和 unsupported。OpenAI Codex 在模型调用报告额度前返回 `USAGE_PENDING`，之后返回 grant 邮箱、可空套餐、额度窗口和可选额度余额；快照仅保存在 Host 内存中，并按已存 grant 的 issuer 与 subject 隔离。账户响应不包含凭据值。

同一 Cordis-free 安装还提供 `clientNativeWorkspace` 与 `clientNativeDirectoryPicker`。Workspace 方法以 `{ workspaces, archivedSessionIds }` 返回 `list()`，以完整基线及后续 upsert/remove/order/archive 帧返回 `follow(signal)`，并提供创建、重命名、仅删除注册、排序、会话排序、归档、按标题或路径大小写不敏感搜索及 `connectWorkspace`。创建与连接接受可选的 `trust` 标记；Host RPC 错误会保留 code 与 details，供信任确认流程使用。删除会释放该 Workspace 的空闲运行时路由，同时保留目录与 Session 日志。连接会复用未归档、属于该 Workspace、记录的 `cwd` 与 Workspace 路径一致且尚未开始 turn（或记录定时任务通知）的 Session，否则会创建并关联一个空白 Session。目录方法提供 Host OS 目录对话框、单层 `{ path, entries, crumbs }` 浏览以及创建一个子目录。Host 集成从 `workspaces` 子路径导入可序列化的 Workspace 与目录类型。

`clientNativeSchedule` 服务通过 `list()` 和 `follow(signal)` 提供活动、暂停和失败任务行。完整基线及后续 upsert/remove 帧只包含计划元数据，不包含提示或执行配置；Host 错误保留 `native/schedules` 错误码。

`clientNativeWorkspaceFiles` 服务提供 `list(sessionId, path, signal?)`、`stat(sessionId, path, signal?)`、`follow(sessionId, signal)`、`read(sessionId, path, range, signal?)`、`readAll(sessionId, path, signal?)` 和 `readRelated(sessionId, path, relativePath, signal?)`。路径相对于该 Session 的工作区；`relativePath` 从基础文件所在目录解析。目录列表返回 `{ path, entries, truncated }`；stat 返回 `{ absolutePath, version, bytes? }`；文本页增加 `{ offset, text, lines, eof }`；完整读取增加 `{ offset: 0, data, eof: true }`，其中 `data` 是 base64 字节。`follow` 先产出 `ready` 帧，再产出 Host 仪表化文件系统观察生成的 `change` 帧；中止其 signal 会结束流。这些方法复用 `@deepseek-ai/dsh-api-workspace-files/native-types` 中的响应类型。

```ts type-equiv
/** Settings views and the Host-validated request budgets used by the Client. */
interface NativeSettingsDescription {
  /** Whether the Host has a local settings document `settingsOpenDocument` can open. */
  readonly hasDocument: boolean
  /** Registered, redacted Settings namespaces. */
  readonly namespaces: readonly NativeSettingsDescriptor[]
  /** Per-request limits enforced by the selected Host. */
  readonly limits: {
    /** Maximum credential refs accepted by one read request. */
    readonly maxCredentialRefsPerRead: number
    /** Maximum operations accepted by one atomic Settings mutation. */
    readonly maxSettingsOperations: number
  }
}
```

`uploadFile(sessionId, file, signal?)` 会将字节流式传到 Host 并返回进程内回执。初始 prompt、`queueContent` 和 `steerContent` 可将这些回执与有序文本、编码图片一起提交；Host 在根所有者内准入图片，并在持久化准入后退休文件回执。图片限额来自选定附件 Provider。图片读取只发送 Session 身份和已记录附件身份，并在返回 Blob 前验证响应媒体类型及字节长度。

`close()` 会解除 Client 已拥有提示和跟随流的等待，中止上传，并等待这些调用结算；原生安装器在卸载时等待该操作。

已发布声明引用 native-runtime、client-connection、native-model-selection、agent-presets、workspace-files 与 brand，因此这些包作为生产依赖安装以供类型解析。共享 Session 包仍为 peer，因为事件验证与格式解释使用应用的同一份 Session 实现。

提示先取得确切准入身份，再等待结算。调用方在发送前取消时拒绝准入；轮次信号会使用该身份请求 Host 排空。detach 信号只停止本地等待，Host 执行会继续。断开轮次结算后会退休其无人接收的结果，之后可准入下一次提示。待处理轮次和结算等待者分别受 maxPendingRequests 限制。安装关闭会解除 Client 等待；Host 回合继续运行，直至正常结算或显式取消。

`queue(sessionId, prompt, requestId, signal?)` 与 `steer(...)` 仅当此 Client 的 root turn 活动时，才会分别将文本提交到 `next-turn` 与 `next-step`。`queueContent(sessionId, content, requestId, signal?)` 与 `steerContent(...)` 接受有序文本、编码图片和暂存文件回执，并提交到相同 inbox。`dequeue(sessionId, requestId)` 会从任一 inbox 移除仍在等待的请求。`submissions(sessionId, signal?)` 返回 `{ throughSeq, submissions }`，其中包含完整的持久化待处理消息。`editSubmission(sessionId, requestId, text, signal?)` 会通过精确的 root owner 替换消息全部 content，同时保留身份与位置，也支持 idle maintenance；`promoteSubmission(sessionId, requestId, signal?)` 会将 queued 输入移到 `next-step`，并要求活动浏览器轮次。其结果分别区分 `updated`/`stale` 与 `promoted`/`stale`/`not-promotable`。`nativeSubmissionRequestId(value)` 会为调用方生成的稳定 id 加类型标记；该 id 会成为持久化用户消息 id。Queue 与 steer 在 Host 持久化准入后完成；拒绝时会以 `NativeSessionRpcError` 拒绝，并在 details 中包含 `requestId`。`prompt` 使用观察者时，其跟随回调会收到使用同一 id 的 accepted、rejected、settled `submission-update` 帧。

<a id="invariants"></a>

跟随流也传输临时审批与问题批次。answerHuman 只使用本 Consumer 尚未结算的调用标识；Host 校验待答根所有者与输入。审批决定为允许一次或拒绝。问题答案保留所选标签与自定义文本。这些展示不形成第二份持久日志。

## 不变量

本包不发布运行时不变量伴生入口，因为 Client 的每 Session 准入映射和待处理 Promise 用精确 Host 准入标识关联传输调用、取消和人工回答；持久 Session 事件与写入者身份仍由 Host 拥有，因此 Client 不保留第二份 Session 投影。

<a id="dev-note"></a>
## 开发备注

原生 Session 执行器拥有持久化与 Agent；该包只拥有传输操作。

<a id="model-experience"></a>
## 模型体验

### 人工输入

#### 模型看到什么

提交的人工文本、已准入的持久化图片引用及暂存文件块会到达 Host 执行器；Host 的附件感知 `read_file` 工具会向模型提供上传字节。

#### Token 影响

`session/prompt` 的 `prompt` 文本作为普通用户消息计入当前及后续恢复请求。

#### KV Cache 影响

该包不改变历史前缀；新增用户消息延长请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- 完整产品 UI 和音频上传不由该包提供；文件上传可通过带类型的 Client 操作完成。
- Host 只能为已附加的 root owner 查询活动定时任务；冷态 Session 行的 `hasActiveSchedule` 为 `false`，因为 scheduler 清单按 owner 限定。

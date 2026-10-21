---
description: "原生 Web Session 生命周期的共享执行与浏览器传输。"
kind: "package-reference"
---

# 原生 Web Session 控制器

[English](README.md) | 中文

## 概述

该 Host Program 向共享 Connection 注册经过认证的 Session 操作，并使用选定的原生 Agent 与 Session 执行器。Web Host 仍是应用入口。

## 目录

- [参考](#reference)
- [不变量](#invariants)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)
- [模型体验](#model-experience)

<a id="reference"></a>
## 参考

配置包含原生 headless 的工作区、模型、提示与预算，以及必填正整数限制 maxPendingRequests、maxHistoryEvents、maxPromptChars、maxFollowBufferBytes、maxFollowers、maxPendingHumanRequests。`maxFollowers` 分别限制 Session、工作区文件和 Workspace 流的并发跟随者数量。`workspaceFiles` 限制默认为每个文本页 2 MiB、每个完整文件 32 MiB、每页 5,000 行和 2,000 个目录项。`maxCredentialRefsPerRead` 与 `maxSettingsOperations` 默认为经过校验的正安全整数上限 64 和 512。`settings/describe` 会随 namespace descriptor 公布这两个值；Host 在调用 Provider 前拒绝超限设置修改，保留一次 revision 检查的原子写入。凭据读取会执行公布的单请求上限。历史超限时拒绝，不进行截断。普通请求与取消／状态请求分别进行有界准入，避免提示队列占满后无法取消。

Client Consumer 提供列表、空白创建、历史、显式新建／恢复提示、取消与状态。提示成功在持久化结算后返回；执行器的确切取消原因在排空后返回 exitCode 130。每个 Session 接受一个待完成浏览器轮次。繁忙提交明确拒绝，不静默加入另一个队列。活跃历史使用确切的当前写入者；冷态历史在回复前关闭读取句柄。安装卸载撤销路由、取消请求并排空执行器。

当此 Program 的浏览器轮次处于活动状态时，`session/queue` 与 `session/steer` 接受带稳定身份的文本。队列操作将消息追加到 `next-turn`；steer 将消息追加到 `next-step`；`session/dequeue` 会移除仍在待处理 inbox 中且身份匹配的消息。`requestId` 会复用为持久化用户消息 id，`session/submissions` 返回两个待处理 inbox。由带观察者的提示创建的跟随流会发送 accepted、rejected、settled 请求的 `submission-update` 帧。准入失败详情会包含 request id。普通 prompt 仍只准入一个待处理轮次。

`session/list` 投影持久历史与确切活跃 owner，添加已确认的工作区归属，并按最新事件时间排序。历史无法读取的行仍会显示，标题标记为不可用；`updatedAt` 回退为 `header.createdAt`，`blank` 和 `completed` 为 false，运行状态及 Host 管理的字段仍会投影。经过身份验证的 POST `/api/native-session/list-follow` 接受 `{}`，然后流式发送基线及合并后的 upsert／remove 帧。`maxFollowBufferBytes` 限制非空基线和每条 upsert 帧的编码字节数：基线超限时先发送空基线，再逐 Session 发送 upsert；单条 upsert 超限时跳过。`session/search` 接受 `{ query, cursor? }`，每页最多扫描 100 个 header，并返回最多 20 个标题或当前消息匹配结果。`session/archive` 委托 `workspaceRegistry.archiveSession` 并返回 `{ archived: true }`；缺少该注册表时以 `native/sessions` 失败。

经过身份认证的 `session/command` 端点接受 `{ sessionId, line }` 形式的一条完整已注册斜杠命令。它要求所选 Session 空闲，在确切 Program root owner 上重新校验命令，并在维护操作结算后返回共享的 `CommandExecution`。请求取消信号会传入命令；Host 会在结算前将其排空。

经过身份认证的 `session/commands` 端点接受 `{ sessionId }`，并返回所选 Session 确切 Program root Agent 可用的 `{ commands }`。每个有效描述符包含名称、说明，以及可选的输入提示和附件支持信息；查询会检查 Web Program 的命令可见性，但不会分派命令处理器。

Session 文件 RPC 使用 `session/files/list`、`stat`、`read`、`read-all` 和 `read-related`，请求包含 `{ sessionId, path }`，必要时还包含 `range` 或 `relativePath`。Host 将每个路径（包括从基础文件目录解析的 `readRelated` 路径）限制在 Session 的 `cwd` 内；header 缺少 `cwd` 时使用所选 Workspace 或配置根目录。绝对路径以及解析到根目录外的路径或符号链接会以 `native/session-files` 失败。Host 会先解析根目录，因此 Session `cwd` 是目录符号链接时也可列出 `.`。Linux 文件包含检查使用已打开描述符的 `/proc/self/fd` 路径。没有 `/proc` 的系统会在真实路径上检查包含关系，将已打开描述符与重新打开的路径按设备号和 inode 核对，并确认路径仍解析到自身。文件读取和 stat 使用原始描述符。Linux 列表从已打开的目录描述符枚举；macOS 列表使用已验证的真实目录路径，并在读取后复核其设备号和 inode。`list` 返回 `{ path, entries, truncated }`；`stat` 返回文件身份与版本；`read` 接受从 1 开始的行范围；完整读取返回 base64 字节。经过身份验证的 POST `/api/native-session/files-follow` 会在入队前过滤观察，以 `maxFollowBufferBytes` 限制待发送 SSE 编码字节，并在超限时关闭；断开或取消也会关闭流并释放跟随者槽位。

控制器要求 `workspaceRegistry`，并提供 `workspaces/list`、`workspaces/create`、`workspaces/rename`、`workspaces/delete`、`workspaces/reorder`、`workspaces/reorder-session`、`workspaces/archive-session`、`workspaces/search` 与 `workspaces/connect`。经过身份验证的 POST `/api/workspaces/follow` 先发送完整基线，再发送 Workspace upsert/remove/order 与归档集合帧。移除 Workspace 注册前，`workspaces/delete` 会退休其空闲 Session owner 并释放已选运行时路由；目录与 Session 日志都会保留。native-web profile 将 Workspace 注册表安装到共享 JSON domain 存储，并配置 `workspaceRoutes`；`connect` 只会选择该路由策略和所选 sandbox policy 允许的目录。

控制器还提供 `directories/pick`、`directories/list` 与 `directories/create-directory`。picker 会打开现有 Host OS 目录对话框；list 返回 `{ path, entries, crumbs }`，create-directory 创建一个子目录。Workspace 失败使用 `native/workspaces`；目录失败使用通用错误消息和 `native/directories`。

可选 modelDirectory 提供模型元数据与 Provider 失败；modelSelection 通过唯一 Session 维护所有者验证并记录意图。选择请求携带确切持久化修订号，并拒绝待完成轮次。保留的 writer 在目录解析及持久化选择之前占用空闲 Agent 维护准入；冷态操作保留既有维护准入。可选 agentPresets 提供已安装组合；rootExecution 执行空白根选择并等待 epoch 清理。`agent-presets/list` 只接受 `{}`，返回默认 preset、已就绪的常驻组合及扫描到的目录摘要；匹配的组合使用目录信任级别，profile 独有的组合使用 `profile`。未注册目录保留扫描状态；没有 Registry 时返回 `{ default: null, presets: [] }`。错误码为 `native/agent-presets`。缺少选择 Provider 时显式修改请求失败，不替换成默认值。

`session/mode-controls` 通过确切 root owner 读取所选 preset、已安装选项、修订号与永久空白 Session 锁定状态；未安装 preset Registry 时没有选项且 `canSelect: false`。`session/select-preset` 保留 root executor 的修订检查与空白 Session 要求。同一读取还会返回 plan mode 的可用性与状态。`session/select-plan-mode` 委托已安装的 Native plan-mode 状态机，包括等待下一 step 应用的选择。

`session/permission-controls` 返回所选 permission Provider 的有效常驻策略与选项；未安装 Provider 时返回不可用状态。`session/select-permission` 通过 Provider 和确切 Session owner 使用既有 permission、sandbox 与 approval policy 事件写入。它不会回答待处理的一次性审批。Provider、存储与选择失败使用 `native/session`。

`agent-presets/read` 返回一个目录的来源、状态、元数据与原始 `agent.native.json` 文本；profile 独有的组合没有文件内容。`agent-presets/copy` 将已就绪目录复制到 `<DSH_HOME>/.agent-presets`；`agent-presets/delete` 只删除用户目录。`agent-presets/can-open-directory` 报告 Host 打开器是否可用；`agent-presets/open-directory` 打开用户目录，或返回 Host 本地路径。找不到、格式无效和只读拒绝分别保留 `agent-preset/*` 错误码；其他管理失败使用 `native/agent-presets`，打开器失败使用 `native/agent-presets-directory`。文件操作完成后，Host 会在设置事件流发布 `agent-presets/updated`。

删除目录后，新的名单读取和新的 preset 解析不会再提供该启动时加载的 preset。已使用该组合的 Session 会继续运行；其插件作用域会保留到 Host 重新加载 profile。

可选 modelDirectory 与 modelSettings 提供 `models/providers`、`models/configurable-providers` 和 `models/discover`。缺少列表 Provider 时返回空列表；目录失败使用 `native/models-directory`，发现失败使用通用消息和 `native/models-discovery`。发现请求接受 Settings namespace 与草稿；传入的 `apiKey` 仅用于该请求，不会返回上游响应正文。POST `/api/native-session/settings-events` 流式发送 Settings 文档、凭据引用、模型适配器与 Agent 预设失效通知，不携带值；取消请求会关闭流。

安装 Settings 与 modelSettings 后，此 Host 会持有 `agent-default-model`。账户授权以 `authorized` 结算后，只有在没有已保存默认值且没有通过 profile 引用、提供方原生认证或已存提供方 key 配置的非账户提供方 API key 时，才会保存第一个已登录账户模型。启用 modelSelection 后，只有当 root Session 历史中没有记录的模型路由时，才会使用已保存的 provider/model；持久化选择和历史请求路由优先。Settings 写入会发布 `settings/document-updated`，账户路由变更后 pi-ai 会发布 `llm/adapters-updated`。

可选 attachments 与 modelDirectory 在根执行内解析实际下一模型后，准入有序的光栅图片上传。共享附件 Provider 验证规范编码及批量限额；只有持久化引用进入用户消息。图片读取由身份认证及完整 Session 历史约束，包含继承引用。端点拒绝其他工作区、不存在的引用及过大图片，并返回已验证的光栅字节、确切媒体类型及 no-store 响应头。目录策略、标题与分叉控制保留为独立 Consumer。

可选跟随通过经过身份验证的 POST `/api/native-session/follow` 发送已接受的持久化事件和临时助手文本。每次准入只允许一个使用确切 Session 与准入身份的跟随者。轮次跟随与列表跟随共用 `maxFollowers` 上限。未读 SSE 队列受字节数限制；超限会取消执行并使结算失败，不遮蔽执行或清理错误。断连释放跟随者及队列；执行器保留轮次所有权直到结算。移除控制器时会关闭路由和已准入请求，先处置其 Session 执行器以取消仍保留的标题提供方工作，再排空跟随任务；即使标题提供方仍安装，排空也会等待其清理完成。

提示先取得确切准入身份，再等待结算。调用方在发送前取消时拒绝准入；发送后取消使用该身份请求 Host 排空，直到持久化结算才结束 Promise。待结算轮次和结算等待者分别受 maxPendingRequests 限制，未领取的结果继续占用槽位。安装关闭取消并排空所有轮次。

<a id="invariants"></a>

可选 approval 与 userQuestions Provider 只为本 Program 拥有的精确活动根调用接入 Web 回答者。执行器在展示或回答前捕获精确应用所有者；仅 Session 标识相同不会准入其他 Program 的请求。人工交互为每次调用按先后顺序呈现的临时请求，全局上限由 maxPendingHumanRequests 指定。回答需要经过认证的 Session、调用与展示标识；过期或取消的回答拒绝。既有 Provider 与工具消费者保持决策审计及结果持久化职责。卸载先撤销待答输入，再等待执行结束。

只有所选 Provider 请求携带完整可复用范围时，审批展示才宣告 `canAllowSession: true`。此时 `session/answer-human` 接受 `{ kind: 'approval', outcome: 'allowed-session' }`，并将记住请求转交既有 Provider。缺少该能力时会拒绝此回答。此 Host 协议不改变当前审批按钮、不根据浏览器数据定义范围，也不绕过一次性沙箱升级。

对于待答问题，`session/answer-human` 接受封闭答案 `{ kind: 'cancel-questions' }`。它以既有 `UserQuestionError` 的 `ASK_CANCELLED` 错误码只拒绝匹配的 Provider 等待，并移除该展示。借用的 turn signal 与其他待处理请求仍保持活动。工具 Consumer 持久化错误，并将其传给下一模型 step，使同一轮可继续。既有身份认证、准入、根所有者与过期展示检查也会拒绝错误所有者、重复及迟到的取消。

可选 Settings 与 Credentials Provider 复用同一经过身份验证的 `/api` Connection 载体。`plugins/inventory` 从可选 `pluginInventory` 服务返回 `{ entries }`（安装 id、名称、作用域、状态、失败阶段），失败时为 `native/plugin-inventory`。`settings/describe` 返回 `{ hasDocument, namespaces, limits }`；`settings/open-document` 在 Host 文本编辑器中打开 Provider 的本地设置文档，没有文档时以 `native/settings` 失败。namespace 为只包含 owner 显式发布 presentation 元数据的活动 namespace，剥离机密值并省略所有 schema 默认值，同时公布经过校验的请求预算。注册时拒绝藏在不支持 schema 节点后的机密字段。`settings/mutate` 按所显示 revision 应用可见路径修改，拒绝机密路径、超过 maxSettingsOperations 的修改以及过期写入；超限修改在 Provider 写入前整体拒绝。Provider 异常文本会替换为通用 Settings 或 Credentials 错误；revision 冲突只保留 namespace 与预期／当前 revision。凭据引用来自这些已注册 schema；`credentials/describe` 只返回 configured/source/writable 事实并执行 maxCredentialRefsPerRead 上限，set 与 unset 只返回确认，不会回读值。

将 `authorizationKeys` 设为页面可授权的凭据 key；允许列表默认为空。Host 通过 `/api` 提供 `authorization/list`、`authorization/begin`、`authorization/answer`、`authorization/decline` 和 `authorization/cancel`，并通过 POST `/api/native-session/authorization` 提供可重放的帧。回答、拒绝和取消请求必须包含当前 `attemptId`；帧不携带机密，断开连接只取消订阅，显式点击取消才会终止尝试。

## 不变量

本包不发布运行时不变量伴生入口，因为本 Program 的轮次表、准入标识和待答人工交互只为精确的执行器所有轮次协调 HTTP 请求；它们不复制 Agent 身份或持久 Session 状态。

运行时入口分块使用发布 manifest 声明的 shared-* 前缀。

CLI 直接携带原生 Web Host、Session 控制器与前端静态产物包。随附 native-web Host 的运行时目录通过该确切 CLI 安装解析前端。前端包发布静态 dist 文件，不声明运行时依赖；其开发用 Cordis 图不作为运行时依赖安装。

<a id="dev-note"></a>
## 开发备注

原生 Session 执行器拥有持久化与 Agent；该包只拥有传输操作。安装可选 modelSelection 服务后会保留所选 Session 模型。

<a id="model-experience"></a>
## 模型体验

### 人工输入

#### 模型看到什么

人工文本及已准入图片引用进入原生执行器的持久化 inbox 与普通 Session 模型历史。选定模型 Provider 将引用投影为图片输入。该 Program 不增加工具或隐藏提示段。

#### Token 影响

`session/prompt` 的 `prompt` 文本作为普通用户消息计入当前及后续恢复请求。

#### KV Cache 影响

该包不改变历史前缀；新增用户消息延长请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- 完整产品 UI、文件及音频上传不由该包提供。
- 控制器对所有 Session 行均返回 `hasActiveSchedule: false`。控制器提供 `rootExecution`，而 `taskScheduler` 要求该服务；若控制器依赖 scheduler 会形成加载循环。

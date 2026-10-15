---
description: "通过共享聊天展示并使用选定 Session 权威的原生 Web 对话。"
kind: "package-reference"
---

# 原生 Web 对话

[English](README.md) | 中文

## 概述

`native-web` profile 使用此 Client 页面创建或恢复 Session、查看持久化历史，并通过 Host 发送消息。Legacy 与 Native 视图共享 `ui-primitives` 中无 Cordis 的转录、composer、首次引导、Markdown、欢迎页与吉祥物展示；Native 页面继续使用自己的 Session 数据层，并依据 Session 记录呈现 Tool 结果、失败及嵌套调用。模型和推理选项来自 Host 模型目录；页面会显示过期选择及传输/历史错误。已发布声明依赖列出的包；profile 还必须选择运行时贡献、renderer 和 `client-native-session` Host 操作。

## 目录

- [参考](#reference)
- [不变量](#invariants)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="reference"></a>
## 参考

页面列出已存储 Session、创建空白 Session、选择持久化历史，并通过显式 resume 发送用户文本。取消期间页面保持忙碌，直至 Host 回复确认执行结算且历史刷新完成。安装释放会取消未完成调用，并等待其结算后释放视图控制器。控制器只保留呈现状态，不建立第二个 Session writer、Agent registry 或连接循环。

只需视图状态控制器的消费者可从 `@deepseek-ai/dsh-client-native-application/controller` 导入 `NativeConversationController`；此 ESM 入口不会加载 React 页面安装器。其声明使用 native profile 必须提供的 `client-native-session` Consumer 类型。

模型与推理强度选项来自 Host 模型目录，包括 Provider 失败；目录只提供发现信息，不作为准入白名单。发现结果不含当前记录路由时仍显示该路由。首次模型控件请求在目录可用前失败时，即使尚未选择 Session，Picker 仍可打开，并会显示请求错误和重试操作。修改携带所呈现的持久化修订号，结算后刷新历史，并显示过期选择失败。已安装预设复用既有空白根锁与 epoch 切换；锁定的 Session 不能更换组合。

转录复用共享 Session 的 append-origin 和消息投影规则。替换副本只用于模型；原始 Session 记录可通过折叠面板查看，包括工具结果、权限、中断及不透明 ignorable 事实。持久化用户文本使用共享右对齐气泡；除 `native-time-context` 提供的上下文外，非用户上下文使用折叠来源行，Native 转录不显示该上下文。助手文本使用共享 Markdown renderer，临时助手文本使用其流式模式。Native 视图按轮次分组可见消息和 Tool 调用卡片，包括嵌套调用，默认折叠助手推理，并为每条助手消息显示复制操作以及可用的 token 用量、耗时和事件时间。顶部读取所选 Session 列表标题，以静态 pill 标记当前对话视图，并保留现有详情操作。读者位于末尾时，视图会跟随新事件和实时文本；向上滚动后暂停跟随，直至读者回到末尾。Tool 卡片复用共享 Native Tool、审批和问题展示；图片仍由 Native 渲染。传输和历史错误会显示；发送失败时保留草稿。

所选 Session 的对话标题栏提供 Trajectory 操作。它使用 controller 当前的事件历史打开共享记录表和时间线，其中包括持久化轮次与消息。它不增加 Host 操作，也不请求更早的历史页面。

Composer 使用共享卡片、工具栏、发送/停止操作、模型与推理选择器、基于 Host 已安装 Agent 预设的模式选择器、权限选择器，以及可选的 Plan 切换按钮。模型选择器读取 Host 目录和所选 Session 的持久化意图，再调用既有选择操作。模式选择器在 Host 不允许选择或首轮锁定后会禁用。Plan 按钮显示已提交与待应用状态，并可在轮次运行期间继续使用；Host Provider 可用时才显示权限选择器。切换 Session 和轮次结算后，控制器会先依次读取两种控件值，再读取最终持久化历史；控件读取可能冷打开 Session 并追加 `session/end-seed`，因此实时跟随开始前显示的转录是最新的。修改失败时也会重新读取显示值。空白 Session 上下文行显示所选 Session 的工作区标签或禁用占位符。切换工作区仍由侧边栏处理。Native 页面不提供命令补全或消息反馈。

本页面拥有运行中轮次时，Composer 可继续输入文字：Enter 或排队将消息加入下一轮，插话将消息加入下一模型步骤，Shift+Enter 换行。待处理消息来自 Host submissions 快照，位于输入框上方，使用紧凑单行预览。右侧依次提供全文展开/折叠、文字编辑、改为插话和删除操作。拖拽排序尚缺 Host 契约，当前不可用。修改保留 requestId，等待 Host 确认后刷新收件箱；失败保留草稿。刷新拒绝旧事件前缀和过期会话选择的响应。轮次结算会保留为后续提交输入的文字。排队和插话暂仅支持文字，使用前需移除所选附件；已提供行内文字编辑，含附件时禁用编辑；侧边栏仍沿用运行中禁止切换会话的限制。

当所选 Session 的已加载历史包含当前 goal 时，composer 堆栈会显示其目标、持久 phase 和已准入轮次进度，包括已完成的 goal。此条带为只读，也不显示进程本地 activation。

配置必须提供正整数 maxLiveTextChars 和 maxLiveEvents，并可选接受 `locale: "en" | "zh"`；省略时采用浏览器的中文语言偏好，否则使用英文。产品文案来自页面完整的类型化字典对。通用设置显示权限、语言、外观、会话字号、对话显示、繁忙发送行为和桌宠开关；Host 提供对应 namespace 时才显示相关设置行，语言和主题会即时生效，并通过 `settingsMutate` 保存已发布的偏好。Composer 从 `ui-conversation.busyEnter` 读取繁忙发送行为，并在提交边界将 `queue`/`steer` 映射为 `queued`/`steering`。Host 未提供该 namespace 时，单一本地缓存使用旧设置值 `queue`/`steer`。对话显示偏好会保存，但 NativeTranscript 尚未读取；桌宠开关会保存，但尚未控制 Native 吉祥物展示。通用设置把 JSON 用户覆盖、schema 详情、凭据和刷新操作收在折叠的“高级设置”中。JSON 编辑保留 revision 检查、分批凭据读取、操作数限制、机密值脱敏和现有数组限制。凭据值只发送到 Host 保存，绝不回读。Host 报告存在本地配置文档时，页眉会显示“打开配置文件”。

在「订阅模型」区域中，每个 Host 授权条目都有独立的一行，显示连接状态和登录操作；匹配的账户卡片显示在该行内。没有匹配授权条目的账户卡片仍显示在此区域。账户卡片显示 Host 投影的 ChatGPT 套餐、额度窗口和 credits，以及 DeepSeek 身份和钱包余额；只有账户 key 与非空提供方身份仍匹配时，刷新失败才会保留已就绪数据并提示可能陈旧（ChatGPT 使用邮箱，DeepSeek 使用联系方式或姓名）。没有身份的成功读取结果只显示本次读取，不可用的余额不会显示为零。退出登录和授权完成后都会重新读取账户及授权流程。页面不直接处理 grant。离开或刷新页面只会取消帧订阅，只有显式点击“取消登录”才会终止尝试。

点击 Settings 按钮会打开居中模态框，提供通用设置、任务中心、模型、插件和 Agent 预设导航。通用设置显示旧版风格的偏好行，并把 JSON 编辑器、凭据和刷新操作收在折叠的“高级设置”中。模型页把 Host 提供方目录、设置与凭据状态合并到 API 模型编辑器中，并在「订阅模型」下保留授权流程和账户卡片。任务中心和插件显示本地化迁移占位文案。Agent 预设显示来源、状态及元数据和原生组合文件；可将就绪目录复制到 Host 用户目录，仅删除用户目录，并打开 Host 文件夹或显示路径。复制和删除会发布失效事件并刷新名单。

React、Session、原生模型选择、Agent 预设、todo Client 值及原生 Session 错误类通过应用共享的 peer 实例解析。Session 数据类型仍仅用于类型；所选运行时 capability 提供 Session Consumer。已发布声明引用 `native-runtime`，因此它仍作为普通依赖。页面在运行时导入 `NativeSessionRpcError`，因此 `client-native-session` 作为 peer 与开发依赖，使页面与所选 Consumer 共用同一个构造器。

native-web 首次使用组合选择此应用、renderer、Connection、Session Consumer 与六个可选 shell installer：locale、theme、Session 展示、layout、左侧栏和右侧详情栏。Host profile 还选择 Session 标题投影和首条 prompt 提供方；旧默认组合保持不变。

首次启动时，页面显示版本化欢迎声明，并将确认状态保存在当前 origin 的 `localStorage`。之后页面读取选定 Host 的活动与可配置模型提供方、Settings namespace 和凭据状态；当没有可用的活动提供方时，共享提供方编辑器通过 `settingsMutate` 和 `credentialsSet` 写入。欢迎确认使用浏览器本地持久化；只要尚无可用提供方或用户尚未关闭本次引导，重载后就会再次出现模型配置步骤。应用根节点 inert 期间，引导页顶部仍提供原生语言与主题控件。

可选 Native 壳通过声明的 Client capability 组合共享 frame、左侧 Session 导航、右侧 Session 详情、locale 与 theme。Session 行读取选定 Host 的持久标题投影；回退/提供方生成、重命名与刷新均通过该 Host 现有 Session 和 RootExecution 权威追加标题事实。Client 复用当前 Native Session controller 与布局 store，不新增第二 Session store。Controller 跟随 Host Session 列表的基线和增量；侧边栏使用其中的活动时间、运行、完成、子代理和待交互字段，并按 Host Workspace 注册表分组。Session 搜索与归档、Workspace 选择/创建/重命名/删除和目录选择均调用对应的 Native Host client。Settings 固定在侧边栏底部，与紧凑 locale 和 theme 控件并列。

<a id="invariants"></a>

带有 `canAllowSession: true` 的审批在允许一次和拒绝旁提供会话动作；其精确可复用范围由 Host 拥有。通用关闭和计划讨论通过 `cancel-questions` 取消整个待答问题批次，同时保持该轮活动。问题卡保留标题、详情、选项、多选和自定义文本。提交失败会保留请求并重新启用控件；只有捕获的同一会话和展示才能接收回答错误或释放提交锁。Host 移除帧负责清除 prompt。整轮取消仍是独立操作，并等待 Host 结算。重载恢复持久决策与工具结果，不恢复过期待答展示。

图片上传使用公布的附件限额及选定 Session 的下一模型。渲染器只展示持久化图片引用，并拥有每次读取、Blob URL 及卸载清理。重新加载从已记录 Session 再次读取图片。上传失败保留输入以便修正。

任务面板读取权威 todo/write 快照，包括已接受的实时与恢复历史。每次替换完整列表，只在 turn/start 清空；turn/end 保留最后的计划。状态文案由 locale 提供，面板不修改任务。

## 不变量

此视图读取选定的 Host Consumer，且不拥有独立执行观察，因此不发布不变量伴生包。

<a id="dev-note"></a>
## 开发备注

生命周期所有权见[对话决策](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-web-conversation.zh.md)；共享展示归属见[聊天展示决策](../../../../../.agents/notes/implemented/architecture/2026-10-12-shared-chat-presentation.zh.md)；实时发送与结算见[跟随决策](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-web-session-follow.zh.md)；Settings 与 Credentials 界面见[原生 Settings 决策](../../../../../.agents/notes/implemented/architecture/2026-10-06-native-web-settings-credentials.zh.md)；提供方编辑与订阅行见[原生 Models 决策](../../../../../.agents/notes/implemented/architecture/2026-10-11-native-models-settings-page.zh.md)；Agent 预设的详情与文件夹操作见[原生 Web Agent 预设管理决策](../../../../../.agents/notes/implemented/feature/2026-10-11-native-web-agent-preset-roster.zh.md)。

Native 审批与问题限制见 [Native human interaction 决策](../../../../../.agents/notes/implemented/feature/2026-10-12-native-human-interactions.zh.md)；事件投影与持久化轮次计时见 [Native Trajectory 决策](../../../../../.agents/notes/implemented/bug-fix/2026-10-12-native-trajectory-turns.zh.md)。

<a id="model-experience"></a>
## 模型体验

### 用户对话

#### 模型看到什么

提交的用户文本及已准入的图片引用记录为 `user/message`。模型意图修改是持久化 `model/selection` 事实；已安装组合的修改使用 `agent-preset/selected`。目录发现与查看历史不贡献模型输入。

#### Token 影响

提交的文本增加普通用户消息 token。此应用不贡献工具或 prompt section。

#### KV Cache 影响

Host 拥有恢复后的上下文和既有前缀。模型与组合修改遵循其所属 Provider 的记录解析及上下文规则。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

持久化事件在执行期间更新转录。临时助手输出显示在共享流式 Markdown 外框中，直到持久化助手记录或结算将其替换。maxLiveTextChars 只保留可见尾部并明确提示截断；maxLiveEvents 拒绝超量呈现历史并取消轮次。重新加载恢复持久化历史，不恢复临时片段。

- 随附 native-web 模板会安装 Standard 和 Minimal Agent 预设、plan-mode Provider 和 permission-preset Provider，因此其中可使用模式选择器、Plan 切换和权限选择器。在其他 profile 中，没有可选预设时模式选择器保持禁用；仅在 Host 提供相应 Provider 时才显示 Plan 切换和权限选择器。欢迎页使用内置吉祥物图集和当前轮次状态，尚未读取桌宠偏好或自定义形态。
- 其他模型片段呈现仍属于独立工作。
- 侧边栏在手动分组视图中通过上移/下移控件持久化 Workspace 和组内会话排序；尚未提供拖动或跨 Workspace 移动 Session 的手势、更多 Session 搜索结果页和 Native Schedule 任务中心。当前 prompt 路径支持图片附件；更广泛的附件/资源管理、不透明凭据 grant 编辑，以及 API 模型以外的 plugin Settings 页面仍属于独立的原生 Client 工作。
- Settings owner 必须显式发布 schema 元数据；此页面不编辑隐藏的 `role('secret')` 值，也不创建授权 grant。

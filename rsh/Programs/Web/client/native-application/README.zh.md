---
description: "通过共享聊天展示并使用选定 Session 权威的原生 Web 对话。"
kind: "package-reference"
---

# 原生 Web 对话

[English](README.md) | 中文

## 概述

`native-web` profile 使用此 Client 页面创建或恢复 Session、查看持久化历史，并通过 Host 发送消息。Legacy 与 Native 视图共享 `ui-primitives` 中无 Cordis 的转录、composer、Markdown、欢迎页与吉祥物展示；Native 页面继续使用自己的 Session 数据层，并依据 Session 记录呈现根级 Tool 结果与失败。嵌套分派仍可在原始历史中查看。模型和推理选项来自 Host 模型目录；页面会显示过期选择及传输/历史错误。已发布声明依赖列出的包；profile 还必须选择运行时贡献、renderer 和 `client-native-session` Host 操作。

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

模型与推理强度选项来自 Host 模型目录，包括 Provider 失败；目录只提供发现信息，不作为准入白名单。发现结果不含当前记录路由时仍显示该路由。修改携带所呈现的持久化修订号，结算后刷新历史，并显示过期选择失败。已安装预设复用既有空白根锁与 epoch 切换；锁定的 Session 不能更换组合。

转录复用共享 Session 的 append-origin 和消息投影规则。替换副本只用于模型；原始 Session 记录可通过折叠面板查看，包括工具结果、权限、中断及不透明 ignorable 事实。持久化用户文本使用共享右对齐气泡；除 `native-time-context` 提供的上下文外，非用户上下文使用折叠来源行，Native 转录不显示该上下文。助手文本使用共享 Markdown renderer，临时助手文本使用其流式模式。Native 视图按轮次分组可见消息和根级 Tool 卡片，默认折叠助手推理，并为每条助手消息显示复制操作以及可用的 token 用量、耗时和事件时间。顶部读取所选 Session 列表标题，以静态 pill 标记当前对话视图，并保留现有详情操作。读者位于末尾时，视图会跟随新事件和实时文本；向上滚动后暂停跟随，直至读者回到末尾。现有 Native 根级 Tool 和图片 renderer 保持原样。传输和历史错误会显示；发送失败时保留草稿。

Composer 使用共享卡片、工具栏、发送/停止操作、统一的模型与推理选择器，以及 Agent 预设选择器。模型按钮读取 Host 目录和所选 Session 的持久化意图，再调用既有选择操作。空会话上下文行显示所选 Session 的工作区标签或禁用占位符；不可用的「模式」选择器保持禁用。切换工作区仍由侧边栏处理。Native 页面不提供命令补全、计划控件、排队/引导操作、轨迹导航或消息反馈。

配置必须提供正整数 maxLiveTextChars 和 maxLiveEvents，并可选接受 `locale: "en" | "zh"`；省略时采用浏览器的中文语言偏好，否则使用英文。产品文案来自页面完整的类型化字典对。Settings 页面读取选定 Host 发布的 schema 与经过校验的请求预算，以带 revision 检查的 JSON 编辑器修改用户覆盖，并根据 `credential-ref` 字段生成只写凭据控件。凭据引用按 Host 公布的上限分批读取并聚合；超过 `maxSettingsOperations` 的修改会在发送前拒绝，以保持每次 revision 检查写入的原子性。可新增、删除或替换不含机密值的对象项；隐藏机密值下方的可见修改按叶子路径写入，不安全的机密结构修改会被拒绝。数组按现有索引修改，不支持的数组结构修改会报错。凭据值只发送到 Host 保存，绝不回读。页面不新增持久化语言偏好或默认 profile 切换。

在「订阅模型」区域中，每个 Host 授权条目都有独立的一行，显示连接状态和登录操作；匹配的账户卡片显示在该行内。没有匹配授权条目的账户卡片仍显示在此区域。账户卡片显示 Host 投影的 ChatGPT 套餐、额度窗口和 credits，以及 DeepSeek 身份和钱包余额；只有账户 key 与非空提供方身份仍匹配时，刷新失败才会保留已就绪数据并提示可能陈旧（ChatGPT 使用邮箱，DeepSeek 使用联系方式或姓名）。没有身份的成功读取结果只显示本次读取，不可用的余额不会显示为零。退出登录和授权完成后都会重新读取账户及授权流程。页面不直接处理 grant。离开或刷新页面只会取消帧订阅，只有显式点击“取消登录”才会终止尝试。

点击 Settings 按钮会打开居中模态框，提供通用设置、任务中心、模型、插件和 Agent 预设导航。通用设置包含已注册设置项与凭据编辑器。模型页把 Host 提供方目录、设置与凭据状态合并到 API 模型编辑器中，并在「订阅模型」下保留授权流程和账户卡片。任务中心和插件显示本地化迁移占位文案。Agent 预设显示来源、状态及元数据和原生组合文件；可将就绪目录复制到 Host 用户目录，仅删除用户目录，并打开 Host 文件夹或显示路径。复制和删除会发布失效事件并刷新名单。

React、Session、原生模型选择、Agent 预设、todo Client 值及原生 Session 错误类通过应用共享的 peer 实例解析。Session 数据类型仍仅用于类型；所选运行时 capability 提供 Session Consumer。已发布声明引用 `native-runtime`，因此它仍作为普通依赖。页面在运行时导入 `NativeSessionRpcError`，因此 `client-native-session` 作为 peer 与开发依赖，使页面与所选 Consumer 共用同一个构造器。

native-web 首次使用组合只选择此应用、renderer、Connection 与 Session Consumer；旧默认组合保持不变。

可选 Native 壳通过声明的 Client capability 组合共享 frame、左侧 Session 导航、右侧 Session 详情、locale 与 theme。Session 行读取选定 Host 的持久标题投影；回退/提供方生成、重命名与刷新均通过该 Host 现有 Session 和 RootExecution 权威追加标题事实。Client 复用当前 Native Session controller 与布局 store，不新增第二 Session store。Controller 跟随 Host Session 列表的基线和增量；侧边栏使用其中的活动时间、运行、完成、子代理和待交互字段，并按 Host Workspace 注册表分组。Session 搜索与归档、Workspace 选择/创建/重命名/删除和目录选择均调用对应的 Native Host client。Settings 固定在侧边栏底部，与紧凑 locale 和 theme 控件并列。

<a id="invariants"></a>

待答工具审批提供允许一次与拒绝操作。问题卡保留标题、详情、选项、多选及自定义文本。提交失败保留待答请求；取消禁用输入，并在 Host 结算前保持执行忙碌。重载恢复持久化决策与工具结果事实，不恢复过期待答展示。

图片上传使用公布的附件限额及选定 Session 的下一模型。渲染器只展示持久化图片引用，并拥有每次读取、Blob URL 及卸载清理。重新加载从已记录 Session 再次读取图片。上传失败保留输入以便修正。

任务面板读取权威 todo/write 快照，包括已接受的实时与恢复历史。每次替换完整列表，只在 turn/start 清空；turn/end 保留最后的计划。状态文案由 locale 提供，面板不修改任务。

## 不变量

此视图读取选定的 Host Consumer，且不拥有独立执行观察，因此不发布不变量伴生包。

<a id="dev-note"></a>
## 开发备注

生命周期所有权见[对话决策](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-web-conversation.zh.md)；共享展示归属见[聊天展示决策](../../../../../.agents/notes/implemented/architecture/2026-10-12-shared-chat-presentation.zh.md)；实时发送与结算见[跟随决策](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-web-session-follow.zh.md)；Settings 与 Credentials 界面见[原生 Settings 决策](../../../../../.agents/notes/implemented/architecture/2026-10-06-native-web-settings-credentials.zh.md)；提供方编辑与订阅行见[原生 Models 决策](../../../../../.agents/notes/implemented/architecture/2026-10-11-native-models-settings-page.zh.md)；Agent 预设的详情与文件夹操作见[原生 Web Agent 预设管理决策](../../../../../.agents/notes/implemented/feature/2026-10-11-native-web-agent-preset-roster.zh.md)。

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

- 随附 native-web 模板具有模型选择，但没有常驻预设组合；自定义 profile 可安装这些组合。欢迎页使用内置吉祥物图集和当前轮次状态，尚未读取桌宠偏好或自定义形态。
- 嵌套 Tool 调用层级及其他模型片段呈现仍属于独立工作。
- 侧边栏尚未提供 Workspace 排序或移动 Session 的手势、更多 Session 搜索结果页和 Native Schedule 任务中心。当前 prompt 路径支持图片附件；更广泛的附件/资源管理、不透明凭据 grant 编辑、API 模型以外的 plugin Settings 页面以及 Models 引导弹窗仍属于独立的原生 Client 工作。
- Settings owner 必须显式发布 schema 元数据；此页面不编辑隐藏的 `role('secret')` 值，也不创建授权 grant。

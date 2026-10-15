# Agent Note: Native Settings pages follow the legacy settings layout

Status: implemented

[English](2026-10-15-native-settings-legacy-alignment.md) | 中文

## Problem

Native Settings 窗口的「通用」页面显示原始命名空间 JSON，「模型」页面的卡片比旧版更宽，「Agent 预设」页面只是一个简单列表。从 Cordis Web GUI 迁移过来的用户会遇到不同的布局，而且不编辑 JSON 就无法修改常用偏好。`native-application` 不能导入 legacy Cordis 插件及其运行时，因此只能依靠 Host 数据重现这些布局。

## Decision

`native-application` 在共享的 [SettingsPanel](../architecture/2026-10-11-shared-settings-panel.zh.md) 中，按旧版的行和卡片结构呈现「通用」「模型」「Agent 预设」和「插件」页面。它不导入任何 Cordis 或 legacy 插件运行时。设置编辑都通过 Host 带 revision 校验的 `settingsMutate` 完成；Web search 密钥使用 Host 凭据操作。页面不保留本地设置存储。

**通用。** 页面包含权限模式、语言、外观、字体大小、对话显示、繁忙时的发送行为（排队发送或插话发送）和桌面宠物等行。每一行写入对应命名空间中的一个字段：`permission`、`locale`、`ui-theme`、`ui-chat`、`ui-conversation.busyEnter` 或 `ui-pet`。语言、外观和字体大小还会立即作用于当前窗口。繁忙发送行使用旧版文案，只写入 `ui-conversation.busyEnter`；写入成功后通知已挂载的输入框，输入框把 `queue`/`steer` 映射为自己的 `queued`/`steering` 默认值。Host 未发布 `ui-conversation` 时，该行被禁用并显示提示，不会改为本地写入。只有 Host 发布了相应命名空间时，权限、对话显示和桌面宠物行才会出现。命名空间 JSON 编辑器和凭据字段移入默认折叠的「高级设置」区域。

**模型。** 在「订阅模型」区域中，授权行、账户卡片和授权错误使用旧版的紧凑卡片、身份行、额度条和次要按钮样式。`account-card.module.css` 只保留账户特有的规则。「API 模型」区域此前已使用 [Models 页面决策](../architecture/2026-10-11-native-models-settings-page.zh.md) 中的共享提供方编辑器，本次未改动。

**Agent 预设。** [预设列表](2026-10-11-native-web-agent-preset-roster.zh.md) 以旧版卡片呈现，分为内置和自定义两组。当前默认预设的卡片会高亮。损坏或需要迁移的预设显示红色边框和徽标；如果 Host 提供了 `problem` 文本，也会一并显示。模式选择开关写入 `agent-presets.modeSelectionEnabled`。点击一张就绪的卡片会写入 `agent-presets.default`，且仅在启用模式选择时允许。describe 成功完成且未返回 `agent-presets` 时，两个控件都会禁用，卡片提示 Host 尚未开放此设置。设置读取期间或事件已宣布更新 revision 但页面尚未读取时，就绪卡片显示刷新提示。describe 失败后，偏好区域显示读取失败提示和重试按钮；就绪的非默认卡片显示对应的失败文案，原始错误与提示放在同一条 alert 中。刷新和读取失败都保留最近收到的设置和 revision；成功读取后仅用相同或更新的 revision 替换，因此较晚返回的写入响应不会覆盖更新的值。设置事件已宣布页面尚未读取的 revision 时，两个控件保持禁用。无论来源或状态，每个预设都保留「查看」按钮。预设查看器在其高层表面上重新绑定主题滚动条。详情提示会区分就绪的配置文件预设、需要迁移或修复的预设，以及没有组装文件的其他预设。

**插件。** 页面为 `shell`、`agent-loop`、`subagent-model-selection` 和 `web-search-deepseek` 命名空间显示四张固定配置卡片。每份草稿固定在开始编辑时的 descriptor revision 上，并通过 `settingsMutate` 按该 revision 写入；发生冲突时会保留草稿，并提示用户放弃修改后重试。刷新会保留最后收到的 descriptor，且仅由 revision 相同或更高的结果替换。事件宣布的新 revision 尚未读取时，保存会被禁用。describe 进行期间，缺失卡片显示刷新等待提示；只有成功 describe 省略命名空间时才显示 Host 缺口提示，describe 失败时不显示缺失卡片提示。describe 失败会保留已收到的 descriptor。加载提示同时覆盖 describe 和设置事件订阅失败；订阅失败时，重试会在当前生命周期内重启订阅，并在模型目录此前已请求过时重新加载。每次重试都会刷新命名空间。Web search 密钥不会回显：`credentialsDescribe` 报告密钥是否已配置及是否可写，非空替换值通过 `credentialsSet` 写入设置文档之外。密钥草稿会记录开始输入时的凭据引用和 descriptor revision；若其中任一已变化，或有已宣布但尚未读取的更新 revision，保存会报告冲突、保留草稿且不写入凭据。设置写入成功后，如果凭据写入或校验失败，草稿会保留密钥并采用已提交的 revision，因此重试时只会写入凭据。提供方优先使用设置文件中非空的字面 `apiKey`，而不是存储凭据。设置脱敏只报告该字段是否存在，不报告是否为空，因此卡片会说明：非空的字面值会覆盖所指的凭据，届时保存的凭据不会生效。插件列表标签页首次显示时延迟读取 Host 安装清单。作用域和 id 都是不透明标识，Host 不提供作用域层级信息，因此清单按首次出现顺序以作用域 id 分组，并用 id 的前八个字符作为组标题。卡片显示短包名和完整包名，可按名称或 id 筛选，展开后可查看身份、作用域、生命周期状态与失败步骤。读取失败可重试，且不会清空已收到的清单。Subagent 路由权限遵循[用户授权的 Subagent 模型路由](2026-08-24-user-authorized-subagent-model-routes.zh.md)。

## Alternatives considered

**导入 legacy 设置插件。** 拒绝，因为它们依赖 native-application 不得加载的 Cordis 服务和 legacy slots。

**Host 命名空间缺失时退回浏览器存储。** 拒绝，因为这会让同一偏好同时由浏览器和 Host 负责，两个值可能不一致。

**继续把 JSON 编辑器作为「通用」页面的主要视图。** 拒绝，因为常用偏好仍需手工编辑 JSON。这些编辑器仍可在「高级设置」中使用。

## Consequences

Native 页面在外观上与旧版一致，同时 Host 仍是唯一的持久化所有者。Host 未注册命名空间的控件会被隐藏或禁用。当前缺口：

- Native Host 尚未注册 `permission`、`locale`、`ui-theme`、`ui-chat`、`ui-conversation` 和 `ui-pet`。因此繁忙发送保持禁用，语言、外观和字体大小只对当前打开的窗口生效。
- Native Host 尚未注册 `agent-presets`，因此在 native-web 中，模式选择开关和默认预设选择保持禁用。
- native-web Host 注册了 `web-search-deepseek`，但未注册 `shell`、`agent-loop` 或 `subagent-model-selection`。Native 清单仅提供安装 id、名称、作用域、生命周期状态和失败步骤；它不提供旧版的 Agent 预设选择器或分组、插件开关与配置，也不提供 Fiber 详情。标签页以一条提示说明缺少按预设分组和插件开关。
- native-web profile 未安装授权服务，因此 `authorizationList` 为空，「订阅模型」区域只显示标题。
- `NativeAgentPresetList` 不提供 `authorable` 或 `modeSelectionEnabled`，旧版的创造模式草稿按钮也尚未移植。

## Verification

native-application 中的 `settings-page.spec.tsx` 覆盖：「通用」各行与仅经 Host 的繁忙发送写入、订阅账户卡片的位置，以及预设分组、默认高亮、损坏状态、每个预设的「查看」按钮、设置写入和 revision 顺序（包括在读到更新 revision 之后才到达的写入响应）。还覆盖插件卡片：按起始 revision 写入、冲突提示、刷新待读与 Host 缺口的区分、初始读取期间的命名空间事件，只写的网页搜索密钥流程（包括完整保存成功和无变化的设置写入）、凭据引用从 A 变为 B 的密钥草稿、此后清空并重新输入、字面 `apiKey` 提示，以及设置写入提交后凭据回读失败时只重试凭据。`plugin-inventory-tab.spec.tsx` 覆盖首次显示时读取、作用域分组和生命周期标签、名称/id 大小写不敏感搜索、重试后拒绝过期响应、作用域折叠与展开、失败卡片的事实（包括失败步骤）以及两种空状态。Agent 预设测试区分命名空间缺失与未读取的 revision，并覆盖配置文件预设、待迁移和待修复详情提示；还验证 describe 失败时只显示一条带重试按钮的读取失败 alert，重试成功后开关可用且预设标签恢复正常。插件 describe 重试测试验证读取失败后可重试，并在成功后显示插件行；还验证重试会恢复失败的设置事件订阅并重新加载此前已请求的模型目录、后续事件会刷新 descriptor，以及刷新失败后缺失命名空间不会显示为 Host 缺口。Web search 重试测试覆盖设置提交后的凭据回读失败、仅重试凭据并成功，以及之后发生 revision 冲突时保留密钥草稿。

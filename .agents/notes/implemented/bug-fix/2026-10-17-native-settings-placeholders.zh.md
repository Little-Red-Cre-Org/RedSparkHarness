# Agent Note: Native 设置页占位内容

Status: implemented

[English](2026-10-17-native-settings-placeholders.md) | 中文

## Problem

2026-10-16 的 UX 审计（N25–N28）发现 native-web 有几个设置页只显示占位文字或一整片禁用控件，没有告诉用户能做什么。“任务中心”只显示“即将迁移”，与侧边栏“定时任务”入口重复，而定时任务的空状态也没有说明如何创建任务。Host 未注册 `agent-presets` namespace 时，Agent 预设页显示禁用的模式开关和橙色警告、变灰的卡片，以及红框“需要迁移”卡片。通用设置在禁用的下拉框旁显示“暂时无法读取繁忙时的发送行为”，“高级设置”直接暴露原始 JSON 覆盖。插件页中，只写着 Host 尚未开放设置的卡片也带展开箭头，插件列表把约 70 个 Host 运行时插件都标为“已启用”，却没有开关。

## Decision

- **N25：**`native-sidebar-settings.tsx` 不再列出“任务中心”；native Host 没有任务中心 API，该页无法显示真实数据。侧边栏定时任务空状态（`ui-sidebar` 的 `NativeScheduledTasksPanel`）新增提示：在会话中让 Agent 创建，并给出示例。native Agent 带有 `schedule_create` 工具，所以这条提示描述的是可用的路径。
- **N26：**`agent-presets` 缺失时，`AgentPresetsSection` 用一条中性说明取代开关区块：新会话使用标为默认的预设，仍可查看和复制预设。此时就绪卡片不再变灰。状态为 `needs-migration` 或 `invalid` 的预设移入折叠的“暂不可用的预设（N）”`<details>` 分组，附简短说明，使用中性或警告标记，不再显示红框。
- **N27：**Settings 读取成功但没有 `ui-conversation` 时，繁忙发送行不再显示禁用的下拉框，而是以文字显示当前生效的值，说明改为 Host 不保存此偏好；读取中或读取失败时仍显示禁用的下拉框和读取失败提示。“高级设置”改名为“开发者选项”，折叠摘要说明其中是原始 JSON 覆盖、schema 和凭据引用。
- **N28：**确认缺少 namespace（已加载、未在刷新、上次读取成功）的插件卡片显示为静态卡片，内嵌“当前 Host 暂不支持配置此插件。”，不显示展开箭头。插件列表按短包名把 `native-*` 和 `storage-*` 插件折叠到“显示/折叠”链接之后，并显示数量；搜索时列出全部匹配项。只读说明改为 Host 暂不支持开关插件。

## Alternatives considered

**保留“任务中心”并跳转到定时任务面板。**未采用：该面板归侧边栏插件所有，为一个重复入口把设置行接过去需要跨插件串联。

**用会卸载内容的开关承载开发者选项。**未采用：折叠的 `<details>` 默认已隐藏内容；改名并加说明即可满足审计要求，也不改变编辑器、凭据和刷新按钮的挂载方式。

**完全隐藏不可用的插件卡片。**未采用：在四个 namespace 都缺失的 Host 上整页会变空；静态卡片至少还能说明有哪些插件。

**插件开关。**未实现：Host 没有启用或停用已安装插件的 API；列表保持只读。

## Consequences

设置页显示四个分区。Host 能力缺失不再使用错误配色。基础设施过滤基于名称规则；不符合这些前缀的插件仍会显示。开发者选项不保存展开状态。

## Testing

`native-application/tests/settings-page.spec.tsx` 覆盖 `agent-presets` 缺失时只显示说明、不显示开关，暂不可用预设分组，只读的繁忙发送回退值，以及静态的 Host 缺失插件卡片。`plugin-inventory-tab.spec.tsx` 覆盖基础设施插件的折叠、搜索和显示。`native-shell.client.spec.tsx` 检查四项设置导航，`ui-sidebar/tests/native-scheduled-tasks.client.spec.tsx` 检查空状态提示。

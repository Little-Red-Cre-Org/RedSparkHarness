# Agent Note: 原生 Web 管理原生 Agent 预设目录

Status: implemented

[English](2026-10-11-native-web-agent-preset-roster.md) | 中文

## 问题

原生 Host 拥有预设目录，而原生 Web Settings 页面需要足够的详情和文件操作来帮助用户管理这些目录。

## 决策

`native-application` 使用选定的 `client-native-session` Consumer 列出预设、读取目录元数据和原生组合文本、将就绪目录复制到 Host 用户目录、删除用户目录，并打开或显示用户目录路径。页面显示预设来源与状态；仅存在于 profile 的组合会显示元数据，不提供目录内容。复制和删除通过现有 Settings 事件流发布 `agent-presets/updated`，页面收到后重新读取名单。原生代码拥有文件操作，且不导入旧版预设运行时。

## 考虑过的替代方案

**保留只读名单。** 这样只能查看预设名称，仍无法使用现有的复制、删除、详情和目录位置操作。

**导入旧版 `ui-agent-preset` 运行时。** 其 Settings 控件依赖旧版注册和 Cordis remotes；原生 Host API 直接拥有这些操作。

## 后果

名单和文件系统仍由 Host 拥有。复制不会替换已有目录，并保留来源描述、采用可选的新显示名称。删除和打开目录都会拒绝 system 预设。删除启动时加载的目录后，新的名单读取和 preset 解析不会再提供该 preset；已使用其组合的 Session 会继续运行，插件作用域会保留到重新加载 profile。复制的目录会出现在实时名单中，但 Host 重新加载 profile 前，不会把其组合安装到当前运行进程。

## 验证

一个 Host 测试覆盖读取、复制、只读拒绝、删除和更新事件。一个 Native Application 测试覆盖详情、复制、显示路径、事件刷新和删除。

## 相关内容

预设组合决策记录在[每个 Session 的 Agent 都由预设 cordis.yml 组合](../architecture/2026-08-03-per-session-agent-presets.zh.md)中。选定的 Client 操作见[原生 Session 包文档](../../../../rsh/Programs/Web/client/native-session/README.zh.md)。

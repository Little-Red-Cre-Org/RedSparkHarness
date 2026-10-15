# Agent Note：Native Plugins 设置卡片

Status: implemented

[English](2026-10-16-native-plugins-settings-cards.md) | 中文

## 问题

Native Settings 需要一种由 Host 提供支持的方式来配置内置插件 namespace，同时不读取本地配置文件，也不导入 Cordis 插件 UI。

## 决策

Plugins 配置标签页在 [Plugins 区域](../../../../rsh/Programs/Web/client/native-application/src/plugins-section.tsx)中提供四张卡片：Shell（`shell`）、Agent 循环（`agent-loop`）、Subagent（`subagent-model-selection`）和 DeepSeek 网页搜索（`web-search-deepseek`）。

每份设置草稿都会保留开始编辑时的 descriptor revision，并通过 [`NativeSessionClient.settingsMutate`](../../../../rsh/Programs/Web/client/native-session/src/native.ts)提交该 revision。Host 报告冲突时，草稿仍可继续修改，页面会显示冲突提示。

刷新期间会保留最近收到的设置 descriptor 和 revision、凭据元数据及模型目录；加载或失败状态单独变化。较早的读取结果和更低的 descriptor revision 不会替换较新的数据。

Client 不会读取网页搜索 API 密钥的值。卡片通过 `credentialsDescribe` 读取是否已配置及是否可写的元数据，并通过 `credentialsSet` 发送用户输入；这两个操作都属于 [Native Session client](../../../../rsh/Programs/Web/client/native-session/src/native.ts)。

Host 未提供某个 namespace 时，页面会本地化提示当前 Host 尚未开放该插件的设置；Client 不会回退到本地文件。[Native application locale](../../../../rsh/Programs/Web/client/native-application/src/locales.ts)拥有这条提示文案。

插件列表标签页仍显示本地化的即将推出面板。插件库存管理推迟到后续工作。

Subagent 卡片遵循[用户授权的 Subagent 模型决策](2026-08-24-user-authorized-subagent-model-routes.zh.md)中记录的 Host 自有路由允许列表。

## 考虑过的替代方案

**复用旧版插件设置页面。** 不采用此方案，因为旧页面及其数据集成依赖 Cordis slots；Native Settings 使用所选 Host 的操作，遵循与 [Native Models 页面](../architecture/2026-10-11-native-models-settings-page.zh.md)相同的职责划分。

**Host 未提供 namespace 时从本地文件读取插件设置。** 不采用此方案，因为本页面展示的值由所选 Host 的 Settings 操作负责；本地回退会显示另一个事实来源。

**不检查 revision 便应用草稿。** 不采用此方案，因为用户编辑期间其他写入方可能修改 namespace；`settingsMutate` 会报告冲突，而不会接受基于旧 descriptor 的草稿。

**在本次变更中实现插件库存管理。** 推迟此方案，因为本页面当前管理设置和凭据操作；库存标签页留待后续工作。

## 结果

Native 页面通过 Host 操作编辑四个内置设置 namespace，让待提交草稿始终受开始编辑时的 revision 约束，并在草稿过期时明确提示，而不以推测的本地值替换它。[设置页面测试](../../../../rsh/Programs/Web/client/native-application/tests/settings-page.spec.tsx)覆盖卡片流程，以及刷新未返回 namespace 后仍保留设置 revision 和凭据元数据。

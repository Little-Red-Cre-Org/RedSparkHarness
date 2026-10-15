# Agent Note：Native Desktop 模块页面

Status: implemented

[English](2026-10-14-native-desktop-module-page.md) | 中文

## 问题

Desktop 插件管理 renderer 需要为 Native profile 提供包和 Host 或 Client 安装项控制，同时保留兼容插件流程。

## 决策

插件窗口收到 `dshDesktop.plugins.native` 后，[renderer](../../../../rsh/Programs/Desktop/renderer/plugin-manager.js) 使用它管理包版本以及 Host 或 Client 安装项。包操作与单个安装项控制分开，Host scope 来自库存。新安装项配置以 JSON 输入；留空时省略 `config`，显式 JSON `null` 则作为值保留。

只有 Native `list` 返回 `wrong-profile` 时才选择兼容插件操作。其他 Native 错误仍留在 Native 模式。变更携带当前显示库存的 revision，renderer 不会乐观修改记录。`applied`、`recovery-required` 或 `stale-revision` 结果会触发库存刷新；陈旧操作需要用户再次提交。无法读取新库存时，Native 写操作保持不可用。

Native 页面复用现有 backend status 与 profile 恢复订阅。较新的订阅更新优先于较早发起的状态读取；关闭页面时会解绑订阅并忽略晚到的响应。Native 页面不提供重试按钮。

Renderer 无法观察浏览器激活或 Client 挂载。它显示 backend 返回的操作结果；`applied` 的含义和仍需进行的 GUI 验收由 [Native Desktop 模块管理决策](../architecture/2026-10-14-native-desktop-module-management.zh.md)负责。

## 考虑过的替代方案

**乐观更新库存。** 后端可能拒绝陈旧请求，或在恢复期间报告部分包变更，因此 renderer 猜测的记录可能与持久化状态不符。

**所有 Native 错误都回退兼容操作。** 这可能把 Native 故障导入旧写入路径；只有 `wrong-profile` 能标识兼容 profile。

**添加独立操作进度和 Client 健康 IPC。** Renderer 使用现有 backend status 与最终操作结果。没有 Client 健康通道时，它无法报告浏览器激活或挂载结果。

## 结果

Renderer 测试覆盖包操作、安装意图、配置缺省与 null、revision 刷新、错误路由、状态顺序和页面退出。它们只验证 renderer 行为；仍需通过打包版 Electron GUI 验收 Client 激活与挂载。

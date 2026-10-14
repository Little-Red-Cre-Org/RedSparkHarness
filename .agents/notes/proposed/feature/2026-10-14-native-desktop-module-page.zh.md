# Agent Note: Native Desktop 模块页面

Status: proposed

[English](2026-10-14-native-desktop-module-page.md) | 中文

## 问题

Desktop 插件 renderer 操作旧包记录。Native profile 需要独立的包操作和 Host/Client 安装实例控制，同时不引入另一套包写入器或依赖规划器。

## 提案

按独立审查通过的 Native facade 准备现有 [renderer](../../../../rsh/Programs/Desktop/renderer/plugin-manager.js)。六类操作保留在 `dshDesktop.plugins.native` 下，不把外部接口复制成第二套公共协议。后端是 scope、revision、包所有权、实例能力和保留原因的唯一权威。Client config 输入区分留空和 JSON null，不存储凭据。

只有 Native list 的 wrong-profile 拒绝允许旧操作。应用变更后重新读取库存；陈旧拒绝只刷新，要求用户重新提交。Busy、恢复和不确定 IPC 失败从不重新提交写操作。现有 backend status 和订阅提供 starting/ready/error 及独立的 profileRecovery。页面退出时解绑订阅，晚到查询不能覆盖更新的订阅状态。后端提供适用条件前隐藏 Native 重试启动按钮。

## 考虑过的替代方案

**乐观更新库存。** Manager 可能拒绝陈旧请求，或在恢复时留下部分包变更。Renderer 猜测会误报持久化状态。

**所有 Native 错误都回退旧接口。** 这会把 Native 失败导向旧写路径。只有 wrong-profile 能标识旧 profile。

**操作进度和 Client health IPC。** 约定范围使用请求处理、现有后端状态和最终结果。浏览器激活沿用应用现有的启动错误展示。

## 验收标准

Owner-local JSDOM/VM 测试覆盖六类操作消费者、跨目标重复 id、空 scope、config 缺省与 null、不可变包控制、revision 刷新、失败路由和订阅退出解绑。它们只证明 renderer 准备。集成需要对齐后端正式类型导出、preload facade、shell 入口、错误消息键和重试条件。随后打包 Electron 必须使用真实 Host 和 Client 模块执行六类操作，展示变更后的使用及 Client 启动错误。

## 风险

准备的 renderer 在当前 shell 中尚未启用。接真实服务前须对齐后端对已审查字段的变更。Applied 确认后端结果，不代表浏览器 mount；不承诺回滚或关闭窗口恢复。

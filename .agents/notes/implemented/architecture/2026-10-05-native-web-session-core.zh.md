# Agent Note: 原生 Web Session 传输

Status: implemented

[English](2026-10-05-native-web-session-core.md) | 中文

## 问题

Web Session 传输需要复用选定执行器，防止另建 Agent 循环或写入者。

## 决策

浏览器 Session Consumer 使用经过认证的 Connection 路由注册表。其 Host Program 装配共享原生执行器，不替换 Web 应用的启动服务。显式选定 Session 执行与活跃所有权服务，防止传输适配器另行取得写入者。

提示回复表示已经结算的轮次，而非过早的接纳确认。每个 Session 只接受一个待完成浏览器提示，竞争输入明确拒绝。分别有界的控制准入保证普通回调占满所有槽位时仍然可以取消。历史使用选定活跃所有者，或明确关闭的持久化读取句柄，并拒绝超限正文。

## 影响

共享 Client Session 实现是 peer，包含原生事件验证与格式常量。不增加允许重复依赖实例的例外。验证覆盖真实经过认证的 HTTP 传输、持久化创建／恢复／历史，以及普通准入占满时的取消。完整产品 UI、增量跟随与策略 Consumer 仍属于独立 P4 工作。

## 考虑过的替代方案

直接移植兼容控制器会带入 Cordis 依赖和第二套生命周期，因此采用共享执行器与独立传输准入。

发送与结算分别保留有界传输所有权，取消引用确切准入身份。Client 在取消后保留原结算请求，避免 Fetch 提前中止掩盖 Host 写入者排空。浏览器历史使用 Session 当前验证器的纯叶导出，不复制消息 schemas；CLI 直接携带模板选择的 Session 执行 Provider。

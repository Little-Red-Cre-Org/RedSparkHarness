# Agent Note：原生 Web Connection 与 Client 重载所有权

状态：已实现

[English](2026-10-05-native-web-connection-and-reload-ownership.md) | 中文

## 问题

原生 HTTP 监听器持有已认证的 Connection registry，但领域 Provider 需要在同一个 registry 上贡献 RPC 和 Fetch 路由。只监视 `rsh.client.json` 会漏掉选中 Client 代码和样式的变化。所有者关闭前，已接受的请求与重建必须完成清理。

## 决策

Web Host 从现有监听器 handle 发布 `hostConnection`。领域 Provider 在其中注册路由；载体继续持有浏览器认证与路由所有权。Connection 包暴露有上限的请求所有者，组合载体和安装生命周期的取消，在关闭前停止接收，并等待已接受的回调结束。Consumer 保留自己的 JSON 校验与失败分类。

Client bundler 记录编译输入及未解析的导入位置，包括缺失包导入所需的现有 `node_modules` 目录。实时重载观察这些目录，串行重建，仅在构建成功后发布完整资源表和 revision。构建失败保留当前发布内容，直至缺失的相对导入或包导入恢复。关闭时停止观察并等待已接受的构建。

## 考虑过的替代方案

**为领域创建单独的 Connection registry：** 否决，因为这会让载体与 Consumer 分别持有认证和路由所有权。

**递归监视整个工作区：** 否决，因为无关变化会重建浏览器图，并扩大文件系统观察范围。

## 结果

Web 领域 Provider 可通过载体已认证的 `/api` channel 工作，无需 Cordis。Host 仍不创建 Agent 或 Session 权威。Client 重载替换的是编译图，不提供旧插件 HMR，也不选择完整产品 UI。

## 验证

聚焦的 Connection 请求生命周期与原生 Client 重载场景覆盖接收、取消、源码修改、构建失败和关闭。包构建及原生依赖检查验证发布的 Host 与 Client 入口。

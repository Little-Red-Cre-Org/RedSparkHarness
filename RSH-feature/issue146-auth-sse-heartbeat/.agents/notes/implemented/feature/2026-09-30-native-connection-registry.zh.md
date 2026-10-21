# Agent Note：原生 Connection registry

状态：已实现

[English](2026-09-30-native-connection-registry.md) | 中文

## 问题

原生 Web 与 Desktop 载体需要复用现有 Connection 的认证、RPC 封套校验、精确 Fetch 路由选择和路由所有权，同时不能导入 Cordis Host 服务。

## 决策

`@deepseek-ai/dsh-client-connection` 将路由选择、RPC 解码和浏览器信任检查集中到 `HostConnectionRegistry`。Cordis `HostConnectionService` 通过该 registry 提供原有 WebServer 适配；`./native-host` 提供不依赖 Cordis 的 registry 工厂，由原生载体使用自己的生命周期和传输挂载它。

## 备选方案

如果把 registry 保留在 Cordis Service 内，原生载体就必须重新实现认证和 RPC 校验；如果每个原生 Host 各自复制 HTTP 适配器，又会产生分叉的路由和清理行为。因此共享 registry 只拥有与载体无关的分派，物理挂载留给选定的 Host。

## 证据

- Host 与 Client 两个 TypeScript 编译面均通过共享 registry 和 native-host 工厂检查。
- 现有 Cordis Connection 路由和 Node bridge 测试保持通过。
- 原生 registry 测试覆盖配置拒绝、RPC 挂载与释放、端点分派，以及共享的 403/401 信任栅栏。

## 结果

原生载体负责物理路由挂载和清理；Connection 包保留唯一的认证与 RPC 分派实现。原生工厂不选择传输，也不会静默创建 HTTP 服务，因此 Host 必须显式提供载体后才能暴露路由。

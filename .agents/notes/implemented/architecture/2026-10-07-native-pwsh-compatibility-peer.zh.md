# Agent Note: 为 Native 消费者将 PowerShell 兼容注册表 peer 设为可选

Status: implemented

English | [中文](2026-10-07-native-pwsh-compatibility-peer.md)

## 问题

`dsh-tool-pwsh` 同时发布 Cordis 入口与 Native 入口。Cordis 入口导入 `dsh-tools`，Native 入口导入 `dsh-native-tools`；必需的 `dsh-tools` peer 会让仅选择 Native 包的依赖闭包包含其并未使用的旧依赖。

## 决策

为 Cordis 入口保留 `dsh-tools` peer 与开发依赖，并仅在 `dsh-tool-pwsh` 将该 peer 标记为可选。包依赖策略只在此包导出 `./native` 时允许这个精确 Host peer；Native/兼容导入策略允许 Cordis 入口加载旧值导入，并禁止 Native 入口的源码闭包加载它。

Windows Native profile 继续选择 `dsh-pwsh-sandbox` 与 `dsh-tool-pwsh`。CLI 包仍为其他受支持 profile 直接声明 Cordis 与 `dsh-tools`，因此此包级可选 peer 不会使完整 CLI 安装变成无 Cordis。

## 考虑过的替代方案

移除 peer 会让 Cordis 入口的运行时要求失去声明。让所有包的 `dsh-tools` peer 都可选会削弱无关的兼容契约。拆分 PowerShell 工具包会重复或迁移共享的模型侧行为，而这不是闭合 Native 依赖边所必需的。

## 后果

仅使用 Native 入口的消费者可以省略 `dsh-tools` 及其 Cordis peer 闭包。加载默认 Cordis 入口的消费者必须安装 `dsh-tools`；可选 peer 元数据不会安装或验证兼容面。Native profile 行、Native 服务、审批行为、任务所有权与 PowerShell 执行均保持不变。

## 验证

包依赖检查器要求 `dsh-tools` 仍是匹配的 peer 与开发依赖、仅在此包存在独立 Native 导出时才可选，并会在缺少任一条件时拒绝该边。源码导入检查器将值导入限制在 Cordis 入口。Windows Native profile 组合与真实 PowerShell 行为由本次变更记录的选定 profile 和 Native PowerShell 检查覆盖。

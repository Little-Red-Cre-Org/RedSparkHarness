# Agent Note：过渡期原生源码依赖检查

Status: implemented

[English](2026-09-23-transitional-native-source-gate.md) | 中文

## 问题

最初的严格无 Cordis 源码与 manifest 检查仅覆盖 P1 Core 名单；新建的 P4 原生 Engine 和 Module 包仍按预稳定期 workspace 规则保留强制 Cordis peer，因此未纳入源码扫描。P5 包策略现已区分严格原生包、混合原生导出和旧兼容根入口；每个已声明的原生源码闭包都需要实际检查，同时不能把仍存在的旧根入口误算进该闭包。

## 决定

在 `native-package-policy.ts` 中维护明确的源码 owner 集合。实际执行的 `verify-native-dependencies` 检查两个编译分面内每份严格原生生产 TypeScript 源码，拒绝计算得出或无法解析的模块目标、解析后指向 Cordis 或兼容层的目标、Program 层目标，以及 Core 源码指向更高层的依赖。它把 alias 与相对路径解析到实际目标，而不只检查 import 字面文本。每个声明原生入口的 Core、Engine 或 Module 包都必须属于严格名单、混合安装器／库名单或安全子路径名单。混合包会分别从声明的原生安装器入口、`./native` 库导出或逐个明确标记的安全导出开始，追踪相对引用与包内引用，包括仅类型引用，不扫描无关的旧入口源码。严格的 P1 名单保留现有源码与 manifest 闭包检查。

具有原生导出、但没有安装器 manifest 的混合库使用单独的显式名单。检查器验证导出的声明路径，并在其声明的每个编译分面检查可达源码。这样凭据的原生 Definition 可以独立导出，Cordis 服务与事件声明则留在旧入口。

过渡期检查不会把仅通过源码检查当作包已无 Cordis 依赖的证明。严格原生包现在不声明 Cordis peer；混合包只可为仍暴露旧根入口保留可选 Cordis peer，其已声明的原生导出必须保持无 Cordis。源码检查覆盖两个编译面的严格包，并追踪每个混合原生入口、库导出或安全子路径。完整已安装产品闭包与独立消费方行为仍是单独的 P5 验收项。

## 考虑过的替代方案

**现在就把所有 P4 包纳入严格名单：** 现有强制 Cordis peer 会在计划中的 manifest 和分发迁移前使检查失败，反而掩盖当前已经可以拒绝的直接源码回归。

**在源码文本中搜索 `cordis`：** 文本匹配会漏掉 alias、相对 import、re-export、模块扩充和仅类型引用，还会错误标记注释及无害数据。

**P5 前允许无法解析的 import：** 无法解析的 workspace 目标可能藏匿禁止依赖，因此源码检查现在就拒绝它。

## 结果

源码策略分别维护严格原生 owner、混合安装器入口、混合原生库，以及旧包导出的无 Cordis 安全子路径。检查器从每个导出的声明入口开始，追踪相对路径和包内引用，包括传递类型引用与 alias；严格 owner 则在两个编译面扫描。混合包根入口仍可提供兼容代码；跨包产物与 manifest 闭包仍是明确的 P5 要求。

`credentials` 和 `launch-environment` 包使用混合库名单，因为各自的 `./native` 导出值与类型，而非安装器。凭据键构造函数和数据类型供旧服务共用；Cordis 事件声明留在旧 `./types` 导出中。启动快照和 SSH 查询也与旧 Context 适配器共用，而 `launchEnvironmentOf(ctx)` 留在根入口。要让原生 profile 实际处理凭据，仍需原生凭据 Provider。

## 验证

检查器测试拒绝 Cordis 和 Program alias、仅类型引用、计算得出或无法解析的加载、Core 指向 Engine 的 import、未分类原生入口，以及通过相对或包内类型引用到达 Cordis 的混合导出。正向用例覆盖本地与 Node 内置引用、混合安装器包、混合原生库和安全子路径；严格名单 manifest 负例仍拒绝 Cordis peer。构建后的原生凭据导出也能在解析器拒绝 Cordis import 的独立 Node 进程中加载。这些检查证明源码与指定导出的行为，不代表所有产品分发都已验收。

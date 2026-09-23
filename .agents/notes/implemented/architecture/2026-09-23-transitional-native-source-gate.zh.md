# Agent Note：过渡期原生源码依赖检查

Status: implemented

[English](2026-09-23-transitional-native-source-gate.md) | 中文

## 问题

严格的无 Cordis 源码与 manifest 检查仅覆盖 P1 Core 名单。新建的 P4 原生 Engine 和 Module 包仍按预稳定期 workspace 规则保留强制 Cordis peer，因而未纳入源码扫描。直接指向 Cordis 或 Program 包的源码 import、类型引用、re-export 或动态加载可能进入原生包，却不受实际执行的检查约束。

## 决定

在 `native-package-policy.ts` 中维护独立且明确的 P4 源码 owner 名单。实际执行的 `verify-native-dependencies` 检查两个编译分面内的每份生产 TypeScript 源码，拒绝计算得出或无法解析的模块目标、解析后指向 Cordis 或兼容层的目标、Program 层目标，以及 Core 源码指向更高层的依赖。它将 alias 和相对路径解析到实际目标，而不只检查 import 字面文本。每个声明原生入口的 Core、Engine 或 Module 包都必须属于严格名单、过渡期源码名单或具名混合包例外。对于混合包，检查器从声明的 `./native` 源码开始追踪相对引用和包内导出，包括仅类型引用，不扫描无关的旧入口源码。严格的 P1 名单保留现有源码与 manifest 闭包检查。

具有原生导出、但没有安装器 manifest 的混合库使用单独的显式名单。检查器验证导出的声明路径，并在其声明的每个编译分面检查可达源码。这样凭据的原生 Definition 可以独立导出，Cordis 服务与事件声明则留在旧入口。

过渡期检查不会把仅通过源码检查当作包已无 Cordis 依赖的证明。P4 包仍带有 Cordis peer，其中一些还依赖生产闭包仍与 Cordis 耦合的旧 Engine Definition。P5 必须移除这些依赖、精确分类必需的 peer 与 dependency，并验证声明、包和独立消费者，然后才能扩大严格名单。

## 考虑过的替代方案

**现在就把所有 P4 包纳入严格名单：** 现有强制 Cordis peer 会在计划中的 manifest 和分发迁移前使检查失败，反而掩盖当前已经可以拒绝的直接源码回归。

**在源码文本中搜索 `cordis`：** 文本匹配会漏掉 alias、相对 import、re-export、模块扩充和仅类型引用，还会错误标记注释及无害数据。

**P5 前允许无法解析的 import：** 无法解析的 workspace 目标可能藏匿禁止依赖，因此源码检查现在就拒绝它。

## 结果

P4 期间新增原生包时，需要把其源码 owner 加入过渡期名单。`fs-local`、`fs-observation-policy` 和 `session-persistence-jsonl` 内的原生子入口仍是具名混合包例外：包级名单不能描述它们同时存在的 Cordis 与原生源码树。检查器会检查每个混合原生入口自己的源码闭包，包括传递的类型引用和 alias。最终跨包产物与 manifest 闭包仍是明确的 P5 要求。

`credentials` 和 `launch-environment` 包使用混合库名单，因为各自的 `./native` 导出值与类型，而非安装器。凭据键构造函数和数据类型供旧服务共用；Cordis 事件声明留在旧 `./types` 导出中。启动快照和 SSH 查询也与旧 Context 适配器共用，而 `launchEnvironmentOf(ctx)` 留在根入口。要让原生 profile 实际处理凭据，仍需原生凭据 Provider。

## 验证

实际执行的检查器在当前 P4 工作树通过。负向 fixture 拒绝 Cordis 和 Program alias、仅类型引用、计算得出或无法解析的加载、Core 指向 Engine 的 import、未分类的原生入口包，以及通过相对或包内类型引用间接到达 Cordis 的混合入口；正向 fixture 接受本地引用、Node 内置模块引用、混合安装器包和混合原生库。现有严格名单的 manifest 负例继续拒绝 Cordis peer。构建后的原生凭据导出也能在解析器拒绝 Cordis import 的独立 Node 进程中加载。

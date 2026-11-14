# Agent Note: Native Python code runtime

Status: implemented

[English](2026-11-13-native-python-code-runtime.md) | 中文

## Problem

`code-runtime-python` 以前只能作为 Cordis 插件运行。Native 组合因此不能从这个包提供 `codeRuntime`。实现位于一个继承 Cordis `Service` 的类上，而 Native 源不能导入 `@redspark/cordis`。

## Decision

本包是 mixed。`src/runtime.ts` 拥有 CPython 子进程运行时，既不导入 Cordis，也不导入 `@redspark/rsh-code-runtime`。`src/index.ts` 把该运行时适配为 `CodeRuntime`，并仍是默认导出。`src/native.ts` 提供 `codeRuntime`，并登记同一套拆卸。

`run` 接受可选的 `onStop`。它在已启动的子进程停止时调用一次，且发生在宿主等待该子进程之前。回调抛错会使这次运行 reject。在 spawn 之前返回的请求不通知。Cordis 调用方不传 `onStop`，因此它们的结果不变。

这个入口没有挂到任何随包 profile。发布包不得点名这个实验包。[Native SDK 持久 shell](2026-11-13-native-sdk-persistent-shell.zh.md) 决定保持不挂载。

## Alternatives considered

**从 `native.ts` 导入 Cordis 类。** Native 源不能导入 `@redspark/cordis`，且该类的构造函数需要 Cordis context。

**把运行时复制进 `native.ts`。** 协议处理、预算和拆卸会与 Cordis 路径分叉。

**在这一改动里挂到随包 profile。** 发布包不得点名实验包。选择由哪个组合承载 Python 属于退役计划。

## Consequences

Cordis 调用方仍使用 `PythonCodeRuntime`，错误和结果都不变。Native 宿主可以在没有 Cordis 的情况下安装 `@redspark/rsh-experimental-code-runtime-python/native`。`onStop` 是 Native 的停止通知，Cordis 请求里没有它。可选的 diagnostic 字段已经发布。这个入口保持不挂载。

[fd-3 帧协议](2026-07-31-code-runtime-python-fd3-protocol.zh.md) 记录这个运行时使用的 wire。 [仍依赖 Cordis 的部分](../../proposed/architecture/2026-11-10-what-still-depends-on-cordis.zh.md) 记录了指出这个缺口的调查。 [Native SDK 持久 shell](2026-11-13-native-sdk-persistent-shell.zh.md) 记录了该入口为何保持不挂载。 [Cordis 退役五阶段](../../proposed/architecture/2026-11-12-cordis-retirement-five-phases.zh.md) 仍负责挂载这个入口。[Native 外部 diagnostic](2026-11-13-native-external-diagnostic.zh.md) 记录该字段。

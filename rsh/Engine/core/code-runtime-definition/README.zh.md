---
description: "在代码运行时实现与消费者间共享可移植的运行请求和 Provider 操作。"
kind: "package-library"
---

# @deepseek-ai/dsh-code-runtime-definition

[English](README.md) | 中文

## 概述

本包让代码运行时 Provider 实现同一套请求与结果契约，同时让 Engine 消费者无需导入具体后端即可使用该契约。根入口导出可移植的 binding、结果和运行时接口。它不包含 worker、进程启动器、Cordis Service 或面向模型的工具。

## 目录

- [使用本包](#use-this-package)
- [实现方式](#implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用本包

### 适用场景

`dsh-tools` 和原生应用消费 `CodeRuntimeDefinition`。`native-code-runtime` 实现原生 Host 契约，`compat-code-runtime` 则将相同操作适配到 Cordis Service。消费者另行选择 Provider，并通过其 `run()` 操作传入请求。

### 入口

实现后端或声明 Consumer 依赖时导入可移植类型：

```ts
import type { CodeRunRequest, CodeRuntimeDefinition, NativeCodeRunRequest } from '@deepseek-ai/dsh-code-runtime-definition'
```

<a id="implementation"></a>

## 实现方式

本包拥有可移植的 binding、JSON 值、请求、结果、失败和与语言无关的保留名称声明。`CodeRuntimeDefinition` 接受共享的 `CodeRunRequest`；原生 Provider 还接受扩展了停止回调的 `NativeCodeRunRequest`，供调用方取消其拥有的原生 binding。`NativeCodeRuntime` 增加由 Provider 等待完成的释放操作。后端配置、隔离、取消以及进程或 worker 资源仍由所选实现负责。

本包不发布 `./invariant` companion，因为其值和接口不持有运行时注册表或状态。Provider 与 Consumer 通过同一个根入口共享这些声明。

<a id="further-exploration"></a>

## 延伸阅读

- [代码运行时子系统](../../../Docs/subsystems/code-runtime.zh.md)
- [原生 Worker 线程 Provider](../../../Modules/Official/code-runtime/native-code-runtime/README.zh.md)
- [Cordis 代码运行时桥接](../../../Compatibility/DSH/bridge/compat-code-runtime/README.zh.md)
- [原生代码运行时决策](../../../../.agents/notes/implemented/architecture/2026-09-23-native-code-runtime.zh.md)

<a id="model-experience"></a>

本包不发布运行时 invariant companion，因为本包只包含可移植执行契约；各 Provider 分别拥有后端状态并校验自己的执行生命周期。

## 模型体验

无，因为本包只声明执行操作，不构造模型请求或 Session 事件。

#### KV Cache effect

本包不会新增或重排模型请求内容。

## 已知限制与后续工作

- 本包不执行程序，也不校验后端配置；这些操作由所选 Provider 负责。

<a id="dev-note"></a>

### 开发备注

Cordis Service 与原生 Host Provider 是同一套可移植执行契约的独立实现。

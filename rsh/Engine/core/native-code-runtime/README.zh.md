---
description: "为原生 Host profile 提供不依赖框架的 Worker 线程模型编写 TypeScript 执行。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-code-runtime

[English](README.md) | 中文

## 概述

`dsh-native-code-runtime` 提供原生 Host `codeRuntime` 服务，在全新的 Node worker 中运行一段模型编写的 TypeScript。它接受显式宿主绑定，返回顺序日志及无损 JSON 完成值或结构化失败，并通过原生 profile 生命周期拥有 worker 的释放。它不导入 Cordis service 或 scope。现有 Cordis worker-thread 后端会继续供 Cordis profile 使用，直到默认装配阶段。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

`./native` 入口提供 `codeRuntime`，并接受含四项已验证限制的可选对象：`computeMs` 默认 `60,000` 个 worker 实测忙碌毫秒，`maxWallMs` 默认 `600,000` 毫秒，`maxOutputBytes` 默认 `67,108,864` 个序列化字节，`maxOldGenerationSizeMb` 默认 `512` MiB。未知字段、非正有限数、小于 `4` 的输出上限，以及超出 Node 定时器范围的墙钟上限都会在 profile resolve 时失败。

每次 `run()` 都会剥离可擦除 TypeScript 类型，使用空环境启动一个全新 worker，并通过无损 JSON 桥接已声明的 binding 调用。程序不能完成时，结果会以 `exception`、`timeout`、`abort`、`worker-exit`、`invalid-output` 或 `output-limit` resolve。dispose 后调用或提供无效 binding namespace 属于调用方误用，会触发 rejection。Host 关闭时会释放服务、终止每个存活 worker，并等待其退出。

<a id="model-experience"></a>
## 模型体验

当原生应用渲染代码结果并把它写入自己的 Session 事件时，才会间接影响模型；runtime 本身没有工具 schema、prompt 放置或 Session writer。

#### KV Cache 影响

runtime 本身不会增加模型请求内容；任何请求前缀变化由其消费应用负责。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- worker 终止是隔离措施而非安全边界：模型代码具有与 bash 等价的权限，其派生的 OS 进程可能在 worker 结束后继续运行。
- worker 只有五方法 console shim，并且只支持可擦除 TypeScript；`enum` 等不可擦除语法会以 `exception` resolve。
- binding 值必须是无损 JSON，但在进入有界外层结果前没有独立的字节上限。
- 此 Provider 有意不适配 Cordis code-runtime seam，也不选择 profile 默认值；P5 会在原生 consumer 迁移后负责默认切换。

不发布 invariant companion，因为 worker 协议消息与进程内执行状态在应用记录结果前没有独立的持久化观测。

<a id="dev-note"></a>
### 开发备注

无。

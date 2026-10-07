---
description: "通过原生进程沙箱运行模型编写的 TypeScript，并限制执行资源及管理清理。"
kind: "package-reference"
---

# @deepseek-ai/dsh-code-runtime-process-sandbox

[English](README.md) | 中文

绑定参数与结果使用无传输字节上限的无损 JSON。`maxOutputBytes` 限制程序最终值、日志及捕获的 stderr，不会截断中间业务值。

## 概述

原生 Host profile 在 `read-only` 或 `workspace-write` 文件策略下需要允许 `run_code` 时，可选择此 Provider。每段程序在由选定操作系统沙箱包裹的全新受管理进程中运行，已声明的 binding 调用通过 JSON 行协议返回。沙箱 runner 启动失败会终止本次调用，不会以未受限方式重试。所选沙箱后端会报告文件效果隔离是完整还是部分。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在明确选择原生运行时的 `dsh` profile 中，将 Host `./native` 入口与 `dsh-subprocess-local`、`dsh-sandbox-local`、`dsh-native-sandbox-policy` 一同选择。应用和沙箱策略必须使用相同的工作区根目录。本包不更改默认应用 profile。可选 `computeMs`、`maxWallMs`、`maxOutputBytes` 和 `maxOldGenerationSizeMb` 使用[代码运行时 Definition](../native-code-runtime/README.zh.md#configuration)所说明的已校验默认值。

runner 不可用时会以 `SANDBOX_UNAVAILABLE` 失败。程序异常、时间预算、中止、无效 JSON 值或输出超限会返回结构化 `run_code` 失败；Host 关闭时会先终止并等待受管理进程范围退出。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

Provider 调用 `ProcessSandbox.confine()` 包裹准确的 Node 子进程命令，再通过 `SubprocessOperations` 启动。子进程使用原生 worker-thread 运行时，保留 TypeScript 解析、计算时间计量、输出限制及强制 Worker 中止。JSON 行承载程序、已声明的 binding 调用、回复和单个结果；父进程校验子进程消息，且只调用已声明的宿主函数。subprocess 服务负责终止进程范围并等待其退出。参见 [Provider](src/index.ts)、[私有子进程](../native-code-runtime/src/process-child.ts)和[沙箱定义](../../sandbox/sandbox/src/native.ts)。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [原生代码运行时](../native-code-runtime/README.zh.md) — 程序与结果语义。
- [原生 headless 应用](../../../../Engine/core/native-headless/README.zh.md) — `run_code` Session 呈现。
- [本地沙箱](../../sandbox/sandbox-local/README.zh.md) — 操作系统隔离与 runner 诊断。
- [子进程操作](../../../../Core/subprocess/subprocess/README.zh.md) — 受管理的进程生命周期。

-----

<a id="model-experience"></a>
## 模型体验

消费应用把 `run_code` 加入模型请求并将结果记录在 Session 中时，才会间接影响模型；此 Provider 本身不添加 prompt 或 Session 事件。

#### KV Cache 影响

Provider 本身不增加请求内容。安装它时，消费应用的 `run_code` schema 可能改变请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 文件策略只涵盖文件效果；网络和进程可见性不在沙箱策略词汇范围内。
- Windows ACL 后端报告部分文件效果隔离，包括已记录的外部 Everyone 授权与硬链接限制。此 Provider 不会将该报告称为完整隔离。
- TypeScript 仍仅支持可擦除语法。备选 worker-thread Provider 只适合明确允许未受限代码执行的 profile。

不发布 invariant companion，因为应用记录结果之前，子进程协议没有独立的持久化观测。

<a id="dev-note"></a>
### 开发备注

无。

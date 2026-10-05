---
description: "原生 profile 可接收可撤销的工具贡献，同时应用仍保留唯一的持久 Session 结果记录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-tools

[English](README.md) | 中文

## 概述

`dsh-native-tools` 为原生 profile 添加按作用域可见的模型工具和类型化程序绑定。贡献共享校验、审批、取消和结果处理。应用保留唯一 Session writer，并决定完成的结果何时持久化。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

`./native` 入口接受 `mode: native | ptc | both`（默认 `both`）。Native 模式对模型调用隐藏 `run_code`；PTC 模式只暴露该传输，并要求存在可见的已注册 `run_code`；both 模式暴露所有可见工具。各模式的程序绑定保留同一组按作用域可见的能力。未知配置字段会使激活失败。

Value 贡献声明输出 schema；注册表捕获它，校验分离的 JSON，再呈现规范结果。作用域限制和 guard 在审批前及 executor 进入前检查。移除贡献会关闭准入、取消已捕获调用，并排空实际工作后才完成 disposer。结果 policy 必须恰好委托一次；finalizer 在应用记录结果前完成。只有应用接受该记录后调用 `acceptResult()` 才通知结果观察者。带来源的额外上下文与规范 JSON 分开保留。

纯 `./types` 和 `./presentation` 出口与 Host、Client Consumer 共享持久 PTC 事件 payload 和文件 diff。注册表入口仅属于 Host。这些声明不安装 PTC executor，也不改变 Session 事件名或 payload 字段。

<a id="model-experience"></a>
## 模型体验

通过消费的原生应用间接影响模型。选定的 schema 和呈现结果进入模型请求；带来源的额外上下文成为独立的日志消息。

#### KV Cache 影响

消费应用拥有注册 schema 导致的请求前缀变化。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 注册表提供 PTC dispatch 和 TypeScript/Python 绑定呈现器；实际 code-runtime Consumer 与选定的 runtime Provider 是独立安装项。
- 注册表不打开 Session 存储，也不添加第二执行循环。应用拥有持久事件顺序和模型请求。

不发布 invariant companion，因为不存在对所属应用持久结果接受状态的独立观察。

不依赖框架的 `./presentation` 导出除了文件差异，还拥有搜索卡片的路径及分组匹配结果类型。兼容 Tools 重新导出同一组类型，原生搜索把有界展示元数据与权威 Tool 结果一起持久化。

<a id="dev-note"></a>
### 开发备注

无。

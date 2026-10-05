---
description: "读取选定 Program 中可持续子任务的原生只读 list_agents 工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-tool-subagent-list-agents

[English](README.md) | 中文

## 概述

`list_agents` 工具让运行中的原生 agent 根据持久 id、标签与当前驻留状态找回可持续子任务。内置原生 SDK 与 ACP 配置和选定的 Subagent Provider 一起安装它。

## 目录

- [Configuration](#configuration)
- [Ownership](#ownership)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="configuration"></a>
## 配置

`./native` 入口要求 `tools` 与 `subagents`，只接受空配置。如果 Tools 注册表与 Provider 选定的注册表不同，它会拒绝加载。配置可以省略此包，同时保留 `send_message` 与 `interrupt_agent`。

<a id="ownership"></a>
## 所有权

工具要求选定 Subagent Provider 枚举 Program 现有的 Session 集合；它不拥有存储、Agent、写入器或消息权限。`children` 是默认作用域。`descendants` 按稳定前序遍历直接父子关系，穿过普通 Session 与一次性子任务，但只返回可持续子任务。Program 检查选定工作区、每条检查路径的父子关系及 subagent 委派深度。已关闭的子任务状态为 `ready`；驻留子任务工作时为 `running`，回合之间为 `idle`。候选或中间节点无法读取时会返回逐项诊断，不会隐藏健康的兄弟路径。列举不授予消息投递或打断权限。

<a id="model-experience"></a>
## 模型体验

### 子任务发现

#### 模型看到什么

模型获得带可选 `scope: children | descendants` 的 `list_agents`。成功结果是包含持久 id、标签与状态的 JSON 行；后代还包含 parent 与 depth。诊断行包含 id、原因和后代位置。普通工具结果在下一次模型请求前写入日志。

#### Token effect

schema 增加请求 token；每次结果留在后续模型历史中。

#### KV Cache effect

安装或移除此工具会改变 schema 前缀。列举本身不创建模型请求。

## 已知限制与延期工作

- 选定存储的列举不分页；大型 Session 集合需要扫描全部头信息。
- 观察到的状态可能在后续控制调用前改变。
- 不发布 invariant 配套模块：Program 拥有目录与 Agent 驻留状态，Provider 拥有描述符解释。

<a id="dev-note"></a>
### Dev Note

[原生目录所有权](../../../../.agents/notes/implemented/architecture/2026-10-06-native-subagent-catalog.zh.md)。

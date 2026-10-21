---
description: "按需开放配置的 Native 工具组，保留原有操作权限检查。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-groups

[English](README.md) | 中文

## 概述

此可选 Native 插件在同一 Session 中按需开放配置的工具组。捕获的同一集合同时控制模型 schema 和执行，不改变操作权限。

## 目录

- [配置](#configuration)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="configuration"></a>
## 配置

在同一 profile 作用域中，将此可选 Native 插件安装在所引用的工具之后。它需要 `tools` 和 `activeSessions`，应用必须使用 `builtinTools: false`。配置只有两个字段：`initial` 为初始可见工具名，`groups` 为名称唯一的 `{ name, description, tools }` 条目数组。未知字段和未安装的工具名会使激活失败。未列入这些列表的工具保持隐藏。`request_tool_group` 和已安装的 `run_code` 传输始终可用，两者都不能放入延迟开放组。

已安装 Native 文件工具的 profile 可以添加以下安装条目：

```json
{
  "id": "tool-groups",
  "plugin": "@deepseek-ai/dsh-tool-groups",
  "scope": "root",
  "config": {
    "initial": ["read"],
    "groups": [
      { "name": "editing", "description": "Create or edit workspace files", "tools": ["write", "edit"] }
    ]
  }
}
```

模型调用 `request_tool_group({ "group": "editing" })`。普通工具卡片展示组名及返回的工具 schema。持久化的开放记录在下一次模型请求时生效，也适用于程序中的嵌套工具绑定。当前批次保留已捕获的能力集合。操作审批、沙箱限制和作用域工具限制仍然生效。重复申请在效果上幂等。

开放状态在同一 Session 内累积，并支持冷启动和热恢复。新建及分叉 Session 从 `initial` 开始，继承事件不能向其他 Session 授予能力。恢复时取已记录工具名与当前组定义的交集，因此往组中添加工具不会自动向恢复的任务开放该工具。

<a id="dev-note"></a>
## 开发备注

[决策记录](../../../../../.agents/notes/implemented/feature/2026-10-10-on-demand-tool-groups.zh.md)说明请求边界上的工具选择。不发布 invariant companion：schema 和执行共用注册表选择结果，持久请求头由应用负责。

<a id="model-experience"></a>
## 模型体验

### 工具组发现与开放

#### 模型看到什么

[申请工具](../../../../Docs/tool-catalog.zh.md#deepseek-aidsh-tool-groups)使用配置的组名和描述，目录中的 planning 组只是示例。结果返回所申请组的完整 schema，包括程序调用所需的参数说明。系统提示词保留初始工具指导，每次请求的 schema 和执行检查使用当前捕获的集合。应用记录变化后的请求头，`tool-groups/opened` 保存持久开放记录。

#### Token 影响

初始请求包含配置的基础工具和目录。每次开放将选定组的 schema 加入结果和后续请求，不使用额外模型分类任务或选择阶段。

#### KV Cache 影响

缩小初始 schema 可以减少输入 token。开放工具组可能增加一次模型往返并改变 schema 前缀；实际节省取决于模型价格和缓存行为。工具选择本身不调用模型。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 工具组采用明确配置，不自动推断任务阶段。profile 必须先安装全部引用工具，再安装本插件；后注册工具和修改组定义需要重新配置 profile。
- 工具可见性不会让不受限制的终端或代码运行时变成只读环境。
- 本插件为可选项，不自动启用到日常 profile。

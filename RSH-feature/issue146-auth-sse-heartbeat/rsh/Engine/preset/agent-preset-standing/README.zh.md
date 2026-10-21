---
description: "在原生 profile scope 中注册一个常驻 Agent 装配，供用户在 Session 开始前选择其工具与提示词贡献。"
kind: "package-reference"
---

# @deepseek-ai/dsh-agent-preset-standing

[English](README.md) | 中文

## 概述

原生 profile 可公布一个具名 Agent 装配，供用户在创建 Session 时选择。每个安装项注册自己的 scope，因此其中的工具与提示词贡献和兄弟 preset 相互区分。Program 与 `agent-presets` Registry 拥有 Session 选择和 Agent 替换。

## 目录

- [使用本包](#use-this-package)
- [实现方式](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在原生 profile 中为每个希望出现在选定 `agent-presets` Registry 的装配 scope 安装一个贡献项。

### 适用场景

当原生 profile 需要可单独选择且由 profile 管理的 scope 时使用本包；兼容层 `agent-presets` 入口继续加载 preset 目录和 Cordis 装配。

### 最小配置

在 profile 装配中添加原生安装项，并提供准确的 scope 标识与展示文本：

```json
{
  "id": "preset-minimal",
  "plugin": "@deepseek-ai/dsh-agent-preset-standing",
  "scope": "minimal",
  "config": {
    "id": "minimal",
    "name": "Minimal",
    "description": "Task tracking tools without Goal tools."
  }
}
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `id` | 必填 | Registry 标识；必须匹配 `[a-z0-9][a-z0-9-]*` |
| `name` | 必填 | preset 选择器中显示的非空名称 |
| `description` | 省略 | 随名称展示的可选非空说明 |

可接受字段来自 [`src/native.ts`](src/native.ts) 中的 schema。

-----

<a id="understand-the-implementation"></a>
## 实现方式

<details>
<summary>实现细节——点击展开</summary>

Provider 在 profile 安装项指定的 scope 中贡献一个 `NativePresetComposition`。共享 Registry 发现该贡献；选定的 Program 拥有持久 Session 选择、scope 父子关系与 Agent 生命周期。

| 文件 | 职责 |
|---|---|
| [`src/native.ts`](src/native.ts) | 验证展示配置并注册安装项的 scope |

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [preset 组](../README.zh.md)——查找此包和共享装配 Registry。
- [`agent-presets`](../agent-presets/README.zh.md)——为 Session 选择并恢复常驻装配。
- [Scope 子系统](../../../Docs/subsystems/scope.zh.md)——了解 scope 父子关系与贡献可见性。

-----

<a id="model-experience"></a>
## 模型体验

间接通过安装在此 scope 中的插件影响模型；Agent 首次请求模型前会先选定可见工具和提示词贡献。

#### KV Cache 影响

本包本身不添加提示词内容；模型可见变化由使用它的 profile 中各 scope Provider 拥有。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 选择仅适用于安装此 Provider 的原生 profile；本包不会加载兼容层 preset 目录。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

本包不发布 runtime invariant companion，因为注册状态由共享 Registry 持有，而此 Provider 没有可独立观察的运行时关系。

</details>

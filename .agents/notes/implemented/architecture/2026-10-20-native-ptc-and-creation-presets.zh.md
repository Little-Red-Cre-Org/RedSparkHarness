# Agent Note：Native PTC 与创造模式预设

Status: implemented

[English](2026-10-20-native-ptc-and-creation-presets.md) | 中文

## Problem

Native 名册把 `ptc` 和 `cordis` 标成需要迁移，因为这两个目录只有 `agent.cordis.yml`。Cordis 呈现选择器和 Cordis 工具集是兼容可选包，Native profile 不能安装这些行。

## Decision

Native web 与 TUI profile 注册 `ptc` 和 `cordis` 子作用域。`ptc` 安装标准 persona 和带 `presentation: ptc` 的 `run_code`，并在父作用域发布 `workflow` 时隐藏该继承工具。`cordis` 安装一段 persona，告诉模型如何编写 `agent.native.json` 预设。两个目录都随附含相同行的 `agent.native.json`。`presentAs(mode, scope)` 让子作用域遮蔽 Provider 的工具模式；程序绑定仍然可见。Cordis 组装仍留给旧运行时。

## Alternatives considered

**桥接 `@deepseek-ai/dsh-agent-tool-presentation` 和 `@deepseek-ai/dsh-tool-cordis`。** 拒绝，因为这些包留在 Native Desktop 闭包之外，创造模式仍会在 Native Host 上教 Cordis 组装。

**把共享工具注册表设成 PTC。** 拒绝，因为 standard 和 minimal 会话使用同一个注册表。

**让这两张卡片继续不可选。** 拒绝，因为 Native 会话无法选择随附的 PTC 或创造模式预设。

## Consequences

PTC 会话的模型只看到 `run_code`。其他继承工具仍是程序绑定，但该作用域会在 `workflow` 已发布时隐藏它。创造模式不检查、也不挂载 Cordis 插件；它用文件工具写预设目录。已有 profile 在下次加载时展开新目录，不重写 `rsh.profile.json`。未提供某行所需服务的 profile 把该预设标为无效，Host 仍然启动。已经注册这些 id 的 profile 使用自己的常驻行，并跳过目录行。`minimal` 仍然没有 `agent.native.json`。

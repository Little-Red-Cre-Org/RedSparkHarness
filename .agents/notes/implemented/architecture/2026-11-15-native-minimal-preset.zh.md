# Agent Note: Native Minimal 只有一个持久 shell

Status: implemented

[English](2026-11-15-native-minimal-preset.md) | 中文

## 问题

已发布的 Cordis `minimal` preset 给模型一份固定提示词 `You are a helpful software engineer assistant.`，以及一个平台持久 shell。它抑制运行时上下文快照，也不压缩历史。Native 的 `minimal` scope 以前只注册一个名册行，描述是没有 Goal 工具的任务跟踪，因此选中 Minimal 的会话仍能看到根工具、应用提示词和自动压缩。

## 决定

`native-web` 与 `native-tui` 把 Minimal 安装成自己的 scope。人格行设置 `complete: true` 和 `includeRuntimeContext: false`。Native 提示词注册表只渲染这一段，并记录抑制器。`native-headless` 把 complete section 当作整份系统提示词；当抑制器对该 scope 可见时，跳过系统提示词运行时上下文快照。

常驻行把 `allowedTools` 设为 `bash` 或 `pwsh`，并把 `compaction` 设为 `false`。Agent 在该 scope 中创建时，这一行把继承工具限制为该名称。持久 shell 注册在 Minimal scope，因此遮蔽同名的根一次性 shell。压缩会跳过该 scope 及其后代的自动压力压缩、溢出恢复和手动压缩。

根、Standard、PTC 与 Creation 装配不变。Minimal 的 Cordis `agent.cordis.yml` 仍留给 legacy profile。本记录不移动 `profile: web` 的快照目录。

## 考虑过的替代方案

**在 preset scope 上用空 allowlist 隐藏根工具。** 拒绝。后代 Agent 会把该 allowlist 再次应用到 preset 自己注册的工具上，从而去掉持久 shell。

**让 Minimal 符合旧名册描述并保留 `todo_write`。** 拒绝。已发布的 Cordis preset 是持久 shell，不是任务跟踪器。TUI 上安装在 Minimal 的 `todo_write` 行已删除。

## 后果

在新建的 Native Web 或 TUI profile 上选择 Minimal，会看到一个持久 shell 和固定提示词，该会话也不会通过压缩替换历史。已有 legacy profile 不会被改写。

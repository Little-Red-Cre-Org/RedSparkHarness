# Agent Note：Native persona 直接注册提示词段落

Status: implemented

[English](2026-11-17-native-persona-registers-sections-directly.md) | 中文

## 问题

`native-web`、`native-tui` 与 Desktop 在每个 standing preset 上都安装 `@redspark/rsh-native-persona`。它的 Native 入口通过 `@redspark/rsh-cordis-bridge` 运行随包发布的 Cordis persona 插件，而该桥接会动态导入 `@redspark/cordis`。因此，即使 Native profile 自己的插件图已经不依赖 Cordis，它仍需要 Cordis 运行时；删除 vendor 树会在 persona 激活处失败。

## 决策

`@redspark/rsh-persona/native` 拥有 persona 段落注册：两个段落、完整提示词策略与运行时上下文抑制。段落名称来自 `@redspark/rsh-system-prompt/sections`；顺序由各自的提示词注册表提供，因此 Cordis 注册表保留其具名位置，Native 注册表使用 `@redspark/rsh-native-prompt` 的 `PERSONA_PREFIX_ORDER` 与 `PERSONA_SUFFIX_ORDER`。Cordis 的 `apply` 与 Native installer 都调用这个 owner，只在适配对象与 disposer 绑定方式上不同（`ctx.effect` 与 `NativeContext.effect`）。

`@redspark/rsh-native-persona` 只要求预设作用域的 `promptSections` 能力。它通过 `PersonaPromptSections` 呈现该注册表，不导入任何 Cordis 包。包中移除 `@redspark/rsh-cordis-bridge` 及其 Cordis peer 依赖。

`cordisHostingNativeReferences` 现在只列出 `rsh/Core/runtime-diagnostics/cordis-bridge`；`native-persona` 不再是获准的 Cordis host。

## 考虑过的替代方案

**保留桥接，以后再删 Cordis。** 否决。桥接让每个 shipped Web 与 TUI persona 行都成为 Cordis 运行时消费者，删除的第一步就会在任何 legacy 包被移除之前破坏 Native 启动。

**在 Native installer 中复制 persona 注册逻辑。** 否决。段落名称、顺序与完整提示词行为会在两行之间漂移。共享 owner 保持单一权威。

## 后果

Native profile 可以在未安装任何 Cordis 包的情况下激活 persona 行。Cordis `dsh-persona` 插件保持相同配置、段落名称、顺序与抑制行为。`@redspark/rsh-cordis-bridge` 仍保留给显式托管 Cordis 插件的 Native 入口，但没有 shipped Native profile 再这样做。

# Agent Note: Native 部署人格

Status: implemented

[English](2026-11-09-native-persona.md) | 中文

## Problem

Cordis 的提示词注册表用两个具名区段组成部署人格——`deployment:persona-prefix` 与 `deployment:persona-suffix`——其内容取自 `Config.personaPrefix` / `Config.personaSuffix`。有 38 个录制会话场景以这种方式配置人格，其中多数通过 `{{cwd}}` 与 `{{model}}` 引用。

Native 的提示词注册表没有对等能力。它拒绝任何配置值，只组合其他提供方注册的区段，因此 Native profile 无法声明 Agent 是谁。把那些场景迁到 Native profile 也就无法保留它们模型可见的提示词。

## Decision

`native-prompt` 接受 `personaPrefix` 与 `personaSuffix`，各自以 Cordis 的名称与顺序注册为区段：`deployment:persona-prefix` 为 0，`deployment:persona-suffix` 为 10200。两者都走注册表现有的严格 `{{variable}}` 插值，因此未解析的引用会让装配失败，而不是带着字面花括号送到模型。

共享名称正是要点。在更近作用域注册的贡献会遮蔽祖先的同名贡献，因此注册 `deployment:persona-prefix` 的 Agent 预设会替换部署人格——与 Cordis 上完全一致——而部署文本仍适用于其他每个 Agent。

配置在加载时校验：存在时必须是非空字符串，且不接受其他字段。

## Alternatives considered

**在 `native-headless` 里挨着 `config.systemPrompt` 渲染人格。** 否决。应用已经把注册表渲染出的区段拼接在其配置提示词之后；第二条通道会用与其他区段不同的规则安置人格，且无法被预设遮蔽。

**给 Native 侧另起区段名。** 否决。按名称替换人格的组合届时要在两个运行时各写一个名字，而为 Cordis 写的预设会静默地不再替换任何东西。

**从配置接受任意区段清单。** 否决。区段是带所有者、由所有者释放的贡献；静态配置清单没有所有者，也没有与第一方指引之间的顺序关系。

## Consequences

Native profile 现在以与 Cordis profile 相同的方式声明人格——相同的名称、顺序与插值——因此录制场景的系统提示词可以在任一运行时上复现。这消除了把录制会话场景迁离 Cordis profile 的两个阻塞之一。

人格是注册表中与其他区段并列的一个区段，因此它随其提供方一同消失，并按与其他区段相同的规则被替换。

验证：`tests/persona.spec.ts` 覆盖前缀先于后缀的顺序、按名称的作用域遮蔽、严格变量插值及其失败、配置缺失、后缀相对更晚区段的顺序、配置拒绝与释放。禁用前缀注册会让七个用例中的四个失败。

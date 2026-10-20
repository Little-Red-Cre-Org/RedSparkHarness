# Agent Note: Native 行通过 mixed 桥接托管 Cordis 插件

Status: implemented

[English](2026-10-20-native-cordis-hosting-rows.md) | 中文

## 问题

Native 预设必须运行随包发布的 Cordis 插件，同时不携带遗留装配。该插件需要一个活的 Cordis 上下文和它所读的服务，而两者都在 Native 运行时包集之外。native 源码门禁拒绝引用 `@deepseek-ai/cordis` 的 Native 入口，运行时层级策略也拒绝依赖 Engine 包的 Core 包。因此，放在 Core 并翻译 persona 服务的桥接层同时违反两个互相独立的门禁。

## 决策

`@deepseek-ai/dsh-cordis-bridge` 是 mixed Native entry 包。它拥有 Cordis 上下文和 Native 插件包装器，并把 `@deepseek-ai/cordis` 声明为可选 peer 加 dev 依赖，而不是直接依赖。它的 native 源码由 `cordisHostingNativeReferences` 放行，这是 Native 入口唯一被允许对 Cordis 的源码引用。

`@deepseek-ai/dsh-native-persona` 是 `rsh/Engine/preset` 下的 mixed Native entry 包。它拥有 persona 翻译：`personaServices` 把 Native 提示词注册表呈现为 Cordis 的 `systemPrompt` 服务，并把 persona 段落登记在安装作用域上。翻译放在 Engine 层，因为它读取 `@deepseek-ai/dsh-system-prompt`，而 Core 包不能依赖它。

桥接包只发布宿主。调用方翻译自己的 Cordis 插件所读的服务，并把翻译后的集合交给 `hostCordisPlugin`。

## 备选方案

**把 persona 翻译留在桥接包：** 桥接包会依赖 `@deepseek-ai/dsh-system-prompt` 和 `@deepseek-ai/dsh-native-prompt`，两者都是 Engine 包，运行时层级策略拒绝消费 Engine 包的 Core 包。

**把 Cordis 声明为直接依赖：** 导入 Cordis 运行时的 Native 入口无法通过 native 依赖门禁，而且 Cordis peer 策略要求 peer 与 dev 的形式。

**把桥接暴露为无 Cordis 的 native-safe 子路径：** native 源码图会跟随入口可达的源码，因此仍能到达 Cordis 的子路径一样被拒绝。只有按包显式放行才能解决。

## 影响

Native 预设可以托管随包发布的 Cordis 插件。桥接层拥有 Cordis 上下文的生命周期和插件的拆除；翻译拥有方拥有服务界面。`cordisHostingNativeReferences` 只对托管 Cordis 插件的包放行 Cordis，因此门禁仍然拒绝其他所有 Native 入口里的 Cordis 引用。本决策扩展了 [Native 闭包跳过仅兼容 peer](2026-10-20-native-closure-skips-compatibility-peers.zh.md) 的决策。

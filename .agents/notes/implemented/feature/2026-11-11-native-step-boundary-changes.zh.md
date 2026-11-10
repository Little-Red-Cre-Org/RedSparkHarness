# Agent Note：在 Native profile 上回放步边界处的运行期变化

Status: implemented

[English](2026-11-11-native-step-boundary-changes.md) | 中文

## 问题

有两份录制会在同一个回合的**步骤之间**改变运行期输入，而它们都无法在 Native profile 上回放。

`system-prompt-in-history` 断言：当渲染出的提示词发生变化时，声明 `systemPromptUpdate: 'in-history'` 的路由会在缓存历史之后追加一条新的 `system/message`，而不是替换节点 0。有两点阻碍了它。Native 循环只在**每次运行**渲染一次提示词段落，因此回合中途变化的段落永远观察不到；而且没有任何代码读取路由的 `systemPromptUpdate` 能力，所以即便观察到变化也无处落地。replay Provider 也没有把该能力转发给已解析的模型，尽管它的 Cordis 入口早已这样做。

`model-switch-notice` 在 `todo_write` 之后切换所选模型。Native 循环每步已经会重新读取选择，所以切换机制本就存在——但它经由 `modelSelection` 读取，而后者需要 `modelDirectory`，replay Provider 并不发布该服务。

## 决定

循环在步边界重新渲染提示词段落，并在 `in-history` 路由上把变化后的提示词追加在缓存那份之后。replay Provider 从其配置的模型转发 `systemPromptUpdate`，与它的 Cordis 入口保持一致。

模型切换场景所用的路由目录是**场景局部插件**，而不是把 replay Provider 拓宽。拓宽 Provider 会改变每个 Native 场景共享的组合；一旦尝试，它们会同时失败：profile 行在 manifest 中声明自己发布的服务，给共享 Provider 增加一个服务等于改写了数十个场景依赖的约定。需要额外服务的场景自己提供，不碰共享 Provider。

## 后果

两份录制都能在 Native profile 上回放并各有断言：in-history 场景核对两条 system 记录以及 fixture 在读取后追加的指引；模型切换场景断言两个 request header 与 context 按序携带两条路由。

该场景还显式组合了 `tool-todo`。此前它并不存在，而 `todo_write` 看起来仍然可用，因为没有断言检查它——这提醒一点：以工具调用为主题的场景必须组合该工具，而不是靠假设继承。

## 已考虑的替代方案

**把 replay Provider 拓宽以发布 `modelDirectory`。** 实测损害后排除：每个 Native 场景都会以 `entry provides differs from manifest` 失败，因为共享 Provider 发布的服务是每一行声明约定的一部分。

**in-history 情形改从 session 投影读取回合。** 已排除：投影报告的是开放回合，而不是路由是否希望把变化后的提示词追加；路由能力才是权威。

**只渲染一次段落并缓存结果。** 已排除：该录制的主体恰恰是「渲染出的提示词在步骤之间发生变化」，缓存会抹掉被测行为。

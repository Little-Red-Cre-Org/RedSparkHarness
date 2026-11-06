# Agent Note: Native 触发菜单读 composer，而不是被 composer 读

Status: implemented

[English](2026-11-06-native-trigger-menu.md) | 中文

## Problem

装上 `ui-reference` 的 Native source 之后，`@` 流水线是完整的，却依然不可见：Native 客户端里没有任何东西把一次击键变成 `track()`，也没有任何东西渲染流水线构建出的菜单。`native-application` 的 composer 拥有自己的 `/` 面板，完全不调用 `clientNativeInputTrigger`。

显而易见的接法过不了规划。流水线要求 `clientNativeConversation`——它要为每个会话各管一个控制器——因此反过来要求流水线的会话就构成闭环。这不是风格问题：`resolveInstallation` 按依赖排序安装并直接拒绝环。用完全相同的形状做探针（应用可选地要求触发器、触发器要求会话、二者同处一个作用域）失败于 `native-runtime: dependency cycle at app`。

## Decision

边的方向反过来。会话发布 `clientNativeComposer`，流水线要求它：

```ts ignore-check
export interface NativeComposerService {
  getSnapshot(): { readonly text: string; readonly caret: number }
  subscribe(listener: () => void): () => void
  replaceToken(span: { readonly start: number; readonly end: number }, text: string): void
}
```

三个成员，仅此而已。composer 拥有草稿、光标与 span 运算；流水线拥有检测、候选拉取、菜单存储与 pick 路由。任何一方都不伸手进对方的状态：composer 发布流水线要读的东西并接受一次替换，流水线从不要求 composer 去渲染。

应用从挂载的会话绑定活的 surface，并且无论如何都发布该服务，因此流水线可以在 surface 出现之前就订阅。在那个窗口里 getter 回答空草稿，而不是对只在 composer 上屏期间才运行的调用方抛错。

流水线只订阅一次，把发布的草稿与光标和上次跟踪的那对做比较，只在变化时调用 `track()`。pick 朝相反方向落地：流水线产出替换文本，composer 的 `replaceToken` 把它写进草稿里菜单记录的那个 span。

菜单本身就用浏览器的 `MenuView`，注册进 `native.conversation.overlay`——一个由会话声明、安置在 composer 之上的列表槽位。`MenuViewInjected` 是纯数据接口，Native 服务已经答得出每个成员，因此复用该表面同时也保住了面包屑头部、分组标题与下钻路径——第二份实现得把这些重新挣一遍。

该槽位是 `root` 作用域，因此它的 `inject` 收不到会话 id；注入函数读会话的当前选择，而那也正是 composer 驱动的会话。`session` 作用域的位置在渲染时要求作用域绑定，而 composer 在根作用域渲染。

## Alternatives considered

**让应用要求 `clientNativeInputTrigger` 并自己渲染菜单。** 否决两次：规划器拒绝该环；而且 composer 会因此拥有菜单内容，而在浏览器构建里那是流水线的职责。

**把流水线对会话的依赖改成可选。** 否决：没有会话列表，流水线真的无法为控制器定作用域，可选只会把失败推迟到第一次击键。

**让流水线通过 DOM 读 textarea。** 否决：composer 的草稿是 React state，跨安装读 DOM 节点会让流水线依赖于 composer 恰好挂在哪里。

**写一份 Native 专属菜单、只共享行投影。** 否决：`MenuViewInjected` 不带任何 Cordis 触点，第二份表面等于把一整个成熟组件——样式表、面包屑、分组标题、下钻提示与骨架行——复制一遍去读同一个存储。

**用现有的 `/` 面板渲染菜单。** 否决：那个面板是独立表面，有自己的目录与存储；让它渲染触发行会让同一区域出现两个「什么可见」的拥有者。

## Consequences

- Native 用户按 `@` 现在能看到文件与会话候选，选中其一会把草稿里的 token 替换成与浏览器相同的 mention。
- 两半不可能在「菜单显示什么」上分歧：都从同一个存储渲染 `MenuView`。
- composer 与流水线可以各自独立安装：没有流水线的组合里，composer 发布一个没人读的草稿；没有 composer 的组合里，流水线的 source 名册没有击键能触达。两者都不会装载失败。
- 覆盖：`tests/native-composer.client.spec.ts` 钉住被跟踪的草稿与光标、重复发布的去重、卸载时退订，以及无选中会话时不去问任何会话。

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

流水线只订阅一次，把发布的草稿与光标和上次跟踪的那对做比较，只在变化时调用 `track()`。它同时自己渲染菜单：`native-menu.tsx` 读该会话的菜单存储，注册进会话声明并安置在 composer 之上的 `native.conversation.overlay` 列表槽位。

该槽位是 `root` 作用域、以会话 id 作为 owner props，而不是 `session` 作用域。`session` 槽位在渲染时要求作用域绑定，而 composer 在根作用域渲染；把 id 作为 owner 数据传入，才能让一个根 surface 渲染所选会话的菜单。

## Alternatives considered

**让应用要求 `clientNativeInputTrigger` 并自己渲染菜单。** 否决两次：规划器拒绝该环；而且 composer 会因此拥有菜单内容，而在浏览器构建里那是流水线的职责。

**把流水线对会话的依赖改成可选。** 否决：没有会话列表，流水线真的无法为控制器定作用域，可选只会把失败推迟到第一次击键。

**让流水线通过 DOM 读 textarea。** 否决：composer 的草稿是 React state，跨安装读 DOM 节点会让流水线依赖于 composer 恰好挂在哪里。

**用现有的 `/` 面板渲染菜单。** 否决：那个面板是独立表面，有自己的目录与存储；让它渲染触发行会让同一区域出现两个「什么可见」的拥有者。

## Consequences

- Native 用户按 `@` 现在能看到文件与会话候选，选中其一会把草稿里的 token 替换成与浏览器相同的 mention。
- composer 与流水线可以各自独立安装：没有流水线的组合里，composer 发布一个没人读的草稿；没有 composer 的组合里，流水线的 source 名册没有击键能触达。两者都不会装载失败。
- 菜单每个分组渲染成一列平铺行。浏览器菜单还会渲染分组标题与面包屑头部；本表面两者都不渲染，因此下钻的目录列表只有行，没有回去的路。
- 覆盖：`tests/native-menu.client.spec.tsx` 钉住空分组丢弃、关闭与全空时的渲染、高亮、保持焦点的按下、以及 hover 路由。把空分组过滤与 `preventDefault` 各自改回，都让自己那几条变红。

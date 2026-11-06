# Agent Note: Native 触发菜单跟随 composer 与会话选择

Status: implemented

[English](2026-11-06-native-trigger-menu.md) | 中文

## Problem

装上 `ui-reference` 的 Native source 之后，`@` 流水线是完整的，却依然不可见：Native 客户端里没有任何东西把一次击键变成 `track()`，也没有任何东西渲染流水线构建出的菜单。`native-application` 的 composer 拥有自己的 `/` 面板，完全不调用 `clientNativeInputTrigger`。

显而易见的接法过不了规划。流水线要求 `clientNativeConversation`——它要为每个会话各管一个控制器——因此反过来要求流水线的会话就构成闭环。这不是风格问题：`resolveInstallation` 按依赖排序安装并直接拒绝环。用完全相同的形状做探针（应用可选地要求触发器、触发器要求会话、二者同处一个作用域）失败于 `native-runtime: dependency cycle at app`。

关于表面本身的两个事实决定了其余部分。槽位注入对每个已注册条目只计算一次、永不重算，因此根作用域菜单座位注入的任何东西都必须在构造上就是活的。而浏览器的 `MenuView` 接收的是纯数据接口 `MenuViewInjected`，不带任何 Cordis 触点。

## Decision

边的方向反过来。会话发布 `clientNativeComposer`，流水线要求它：

```ts ignore-check
export interface NativeComposerService {
  getSnapshot(): { readonly text: string; readonly caret: number; readonly revision: number }
  subscribe(listener: () => void): () => void
  replaceToken(span: { readonly start: number; readonly end: number }, text: string): void
}
```

composer 拥有草稿、光标、revision 与 span 运算；流水线拥有检测、候选拉取、菜单存储与 pick 路由。任何一方都不伸手进对方的状态。草稿只有一个 ref 拥有：`replaceToken` 先写该 ref 再通知，因此订阅者读到的内容不会落后于它被告知的文本。

流水线对两类变化都同步发布的草稿与光标——一次击键会重新发布草稿，而切换会话会改变哪份草稿才算数——并在安装时跑一次同步，因此在本入口挂载之前就选中的会话不会被跳过。离开一个会话会关掉它留下的菜单，因为那些行属于用户已经看不见的 composer。composer 发布的 revision 正是命中时盖章用的值，与浏览器检测记录的 `draftRev` 对应。

菜单就是浏览器的 `MenuView`，注册进 `native.conversation.overlay`——一个由会话声明、安置在 composer 之上的列表槽位。该座位是根作用域，因此它的 `inject` 收不到会话 id 且只跑一次：每个成员在调用时解析会话，而 `MenuView` 订阅的两个存储是包装器，它们重新指向所选会话自己的存储，同时保留已经建立的订阅。把捕获的快照交给 `MenuView` 会把它冻结在首次挂载时选中的那个会话上。

## Alternatives considered

**让应用要求 `clientNativeInputTrigger` 并自己渲染菜单。** 否决两次：规划器拒绝该环；而且 composer 会因此拥有菜单内容，而在浏览器构建里那是流水线的职责。

**把流水线对会话的依赖改成可选。** 否决：没有会话列表，流水线真的无法为控制器定作用域，可选只会把失败推迟到第一次击键。

**让流水线通过 DOM 读 textarea。** 否决：composer 的草稿是 React state，跨安装读 DOM 节点会让流水线依赖于 composer 恰好挂在哪里。

**写一份 Native 专属菜单、只共享行投影。** 否决：`MenuViewInjected` 不带任何 Cordis 触点，第二份表面等于把一整个成熟组件——样式表、面包屑、分组标题、下钻提示与骨架行——复制一遍去读同一个存储。

**把菜单放在 session 作用域槽位。** 否决：session 作用域槽位在渲染时要求作用域绑定，而 composer 在根作用域渲染。根座位要付上面那次活的重新指向；仅把会话 id 作为 owner 数据传进来也没用，因为注入在任何 owner prop 存在之前就已缓存。

## Consequences

- Native 用户按 `@` 能看到文件与会话候选，选中其一会把草稿里的 token 替换成与浏览器相同的 mention。
- 两半不可能在「菜单显示什么」上分歧：都从同一个存储渲染 `MenuView`。
- composer 与流水线可以各自独立安装：没有流水线的组合里，composer 发布一个没人读的草稿；没有 composer 的组合里，流水线的 source 名册没有击键能触达。两者都不会装载失败。应用的 `dsh.native.provides` 必须列出 `clientNativeComposer`，因为 Desktop 预检从 manifest 建服务图，而 Web 客户端只读入口。
- 覆盖：`tests/native-composer.client.spec.ts` 钉住被跟踪的草稿、光标与 revision、重复发布的去重、切换会话、关闭被离开会话留下的菜单、卸载时退订，以及无选中会话时不去问任何会话。

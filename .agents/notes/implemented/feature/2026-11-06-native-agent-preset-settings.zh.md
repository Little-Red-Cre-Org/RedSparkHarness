# Agent Note: Native 预设注册表执行选择器所写的那条策略

Status: implemented

[English](2026-11-06-native-agent-preset-settings.md) | 中文

## Problem

Agent 预设有一条用户可写的选择策略：`agent-presets` 设置命名空间，含 `default` 与 `modeSelectionEnabled`。Cordis 入口的配套适配器会注册它，因此浏览器侧的选择器开关写入的字段，正是宿主解析未具名新会话时读的那一个。

Native 入口没有注册这个命名空间。`native-web` 组装了 settings 提供方，Native 设置页也渲染 `agent-presets` 分区——包括那个模式开关——但写入该字段不会改变任何 Native 会话能观察到的东西。更糟的是，这个状态在真正要紧的方向上是单边的：开关持久化了，而注册表仍然用部署默认解析每个新会话，于是隐藏选择器之后，一个陈旧的用户选择仍能决定一个没有任何控件可以报告的会话。

## Decision

`@redspark/rsh-agent-presets/native` 声明 `optional: ['settings']`，并在程序组装了该服务时注册 `agent-presets`，以 `{ default: config.default, modeSelectionEnabled: true }` 为 base——与 Cordis 适配器一致。该注册由安装持有，卸载模块即撤销命名空间。

`NativeAgentPresetRegistry` 接收该 scope，并在每次解析时读一次 `policy()`：

```ts ignore-check
private policy(): { readonly enabled: boolean; readonly defaultId: string } {
  const settings = this.settings?.get()
  if (settings === undefined) return { enabled: true, defaultId: this.defaultPreset }
  return {
    enabled: settings.modeSelectionEnabled,
    defaultId: settings.modeSelectionEnabled ? settings.default : this.defaultPreset,
  }
}
```

两个取值来自同一份快照，因此目录与解析不可能互相矛盾。选择器隐藏期间，未具名的新会话取部署默认，即使用户文档还写着另一个预设——因为没有控件报告那个选择；显式指定的预设不受影响，已恢复的会话保持它当时运行的 standing。

解析器读到的是合并后的 section，因此部分写入中未出现的字段回落到 base。section schema 是 strict 的，未知字段会被拒绝而不是静默存下。

## Alternatives considered

**改由 Web Host 注册该命名空间，而不是预设包。** 否决：这条策略属于预设域，Cordis 入口已在那里持有它。两个持有者会让两个运行时对同一份设置解析出不同结果。

**让 Native 设置页在选择器隐藏时顺手写入部署默认。** 否决：那是用客户端绕开宿主策略的做法，而且另一个调用方（headless、SDK）仍会解析到陈旧的选择。

**把 `settings` 设为必需。** 否决：没有 settings 提供方时注册表照样能服务名册，而 Cordis 侧对同一依赖用的就是 `optional`。

**在注册时读一次策略。** 否决：设置可热重载，缓存的策略会让写入在模块重启前一直不生效。

## Consequences

- 从 Native 设置页写入 `modeSelectionEnabled` 现在会改变宿主解析的结果，与 Cordis 组合完全一致。
- 不组装 settings 提供方的部署保持原行为：名册照常服务，策略报告选择器为显示，部署默认生效。
- 覆盖：`tests/native-settings.spec.ts` 钉住无提供方时的默认、启用时的保存默认、隐藏时的部署默认、显式预设不受隐藏影响、写入无需重建注册表即可观察、已恢复会话保持 standing，以及 plugin 正文（base、空 section 解析、部分写入、未知字段拒绝、无提供方的名册、被持有的注册）。把 `policy()` 的默认值与命名空间注册各自改回，都让自己那几条变红。

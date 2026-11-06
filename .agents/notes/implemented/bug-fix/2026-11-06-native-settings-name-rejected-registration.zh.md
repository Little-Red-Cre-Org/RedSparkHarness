# Agent Note: Native 设置页点名它无法展示的那条注册

Status: implemented

[English](2026-11-06-native-settings-name-rejected-registration.md) | 中文

## Problem

Native 设置面板先画一组固定页面，再画每个包注册进 `settings.section` 的页面。它把合并后的列表按 id 去重并保留第一行，而内置行拼在注册行之前，因此 id 与内置页相同的注册会消失：槽位注册成功、页面无处渲染、也没有任何提示。Plugins 分区的标签栏有同一个缺陷，注册名为 `config` 时会产生两行共用同一个 DOM id 与同一个 `aria-controls` 目标，`getElementById` 与辅助技术都无法判断一个标签拥有哪个面板。

故障在已发布的 Native Web 组合里都不会触发：只有 `ui-settings-models`（id `models`）与 `ui-settings-plugin-inventory`（id `all`）在注册，二者都不与内置冲突。第一个复用内置 id 的包——Cordis 侧的 `ui-settings-plugins`，id 为 `plugins`——会整页丢失且无信号，这违反仓库对错误配置给出的 [fail-loud 规则](../../../../AGENTS.md)。

## Decision

两个界面都走一遍即将展示的 id，并报告它拒绝的那一个：

```ts ignore-check
const shown = new Set(BUILT_IN_SECTIONS.map(section => section.id))
const registered = ledger.sections().flatMap((entry) => {
  if (shown.has(entry.id)) {
    console.warn(`[native-application] settings.section registration "${entry.id}" reuses an existing page id and is not shown`)
    return []
  }
  shown.add(entry.id)
  return [{ id: entry.id, label: entry.label ?? entry.id, order: entry.order }]
})
```

Plugins 标签栏对 `['config']` 施加同样的遍历并渲染过滤后的列表，因此内置配置标签保留自己的 id，冲突的注册不贡献任何一行。

报告用 `console.warn` 而非抛错。设置面板正是用户用来诊断组合的界面，一个注册错误的包不应摧毁它；警告指名槽位与 id，这正是作者修复所需的信息。

## Alternatives considered

**在 shell 中遇到冲突就抛错。** 否决：设置面板本身就是诊断界面。一个把 id 注册错的包会顺带拿掉用户用来查看已安装包的地方。

**静默保留第一行，交给槽位注册表拒绝重复。** 否决，理由有二。冲突并不是槽位注册表的重复——内置页不是注册，`register` 根本看不到它。而且静默丢弃正是 issue 指名的行为：注册报告成功，产品展示别的东西。

**给每条注册各自一行，在渲染时区分。** 否决：面板的正文、导航选中项与 renderSlot 过滤都以 section id 为键，同一 id 的两行会打开同一个正文。

## Consequences

- 组合不再可能丢失一个设置页，或产生重复的标签 DOM id，而不留一条指名槽位与 id 的 console 记录。
- 警告在该冲突存在的每次渲染都会触发，因为投影由 ledger 重建而非记忆化。这是刻意的：ledger 在运行时会变化，记忆化的报告会过期。
- 覆盖：`settings-slots.client.spec.tsx` 用内置 `general` id 注册一个 section，断言只有一行导航并出现警告；`settings-page.spec.tsx` 传入名为 `config` 的标签，断言只存在内置配置标签、其 DOM id 未变、没有克隆行且出现警告。

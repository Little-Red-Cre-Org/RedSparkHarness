# Agent Note：Native 客户端设置页槽位与 open-in-app

Status: implemented

[English](2026-11-05-native-client-settings-slots-and-open-in-app.md) | 中文

## Problem

两处 Native 客户端界面装上了却打不开。Native 设置页自己内联渲染各分区，从不调用槽位渲染器，于是 `settings.plugins.tab` 与 `settings.section` 有声明方和注入方却没有页面。`@redspark/rsh-client-ui-open-in-app` 只有 Cordis 半边，按钮落在 `conversation.session.header.utilities`，而 Native 客户端不声明该座位。

## Decision

Native 设置宿主把 `settings.plugins.tab` 与 `settings.section` 声明为 `sidebar.settings` 注册的子槽位并渲染它们：插件页渲染每个已声明的标签页，模型页渲染过滤为 `models` 的 `settings.section`。`ui-settings-models` 把现有的 `ModelsSection` 注入该槽位，而不是让应用再带一份模型编辑器，并把 `settings.models.provider-card` 与 `settings.models.footer` 声明为该条目的子槽位。`ui-settings-plugin-inventory` 继续注入 `settings.plugins.tab`。

`ui-open-in-app` 新增 Native 入口，复用浏览器半边的 controller、标签表、图标组件与 busy 延迟。两边都经页面 Fetch 载体访问同一批主机路由，所以只有落点与目录来源不同：该入口把分体按钮以顺序 -10 贡献到 `native.conversation.actions`，并从所选会话 header 的 `cwd` 读取工作区目录，因为 Native 客户端没有会话摘要投影。

## Alternatives considered

### 为什么不让模型页保留自己的内联编辑器？

内联编辑器与 `ui-settings-models` 已发布的内容重复，而该包的槽位注册一直是死代码。渲染贡献只留一份实现，也让该槽位门禁有意义。

### 为什么不在 Native 构建上把 open-in-app 按钮放进 Cordis 头部座位？

该座位只存在于浏览器组合。Native 客户端的操作行是 `native.conversation.actions`，注入到那里按钮才会出现。

## Consequences

Native 设置页现在会显示客户端包注册进这两个设置槽位的内容，因此新的设置贡献无需改动应用。模型页重新只显示一个编辑器。open-in-app 按钮在 Native 客户端可用，并通过同一批主机路由继续共享浏览器半边的可用性读取与持久化选择。

# Agent Note: Share the Settings panel as a UI primitive

Status: implemented

[English](2026-10-11-shared-settings-panel.md) | 中文

## Problem

旧 Settings 外壳与无 Cordis 的 native-application 都需要相同的模态导航。本决策把[共享客户端原语规则](2026-09-05-shared-client-control-primitives.zh.md)应用到 Settings 外壳：native 代码不能在运行时导入 `ui-settings-general`，复制面板也会造成视觉实现分属两处。

## Decision

`ui-primitives` 持有 props-only 的 `SettingsPanel` 及其 CSS。组件接收本地化标题和关闭标签、导航行与选择回调、顶部操作及页面内容；它负责居中遮罩、面板、导航图标、关闭按钮和 Escape 处理。`ui-settings-general` 与 native-application 各自通过 props 提供数据和 locale。

## Alternatives considered

**让 native-application 导入 `SettingsRoot`。** 该组件读取旧 slot renderer、locale hooks、connection state 与 onboarding/session state；native-application 到功能包的运行时依赖违反客户端包规则。

**把面板 JSX 和 CSS 复制到 native-application。** 这会让相同 Settings 外壳出现两个持有方，后续视觉调整还需要同步修改。

**让 legacy 与 native 分别保留一套面板。** 这样无需调整包归属，但两个设置窗口会继续视觉不一致，也会重复实现模态行为。

## Consequences

共享组件增加一个公开的 `ui-primitives` 导出，并使两处调用方都无需依赖 Cordis。导航状态、本地化标签、选中页面内容和顶部操作仍由各调用方持有。功能页面仍只能通过 props 跨包传递或迁入 native-application；该原语不充当功能页面桥接层。

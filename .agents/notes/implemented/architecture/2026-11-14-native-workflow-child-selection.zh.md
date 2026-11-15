# Agent Note: Native workflow child selection

Status: implemented

[English](2026-11-14-native-workflow-child-selection.md) | 中文

## Problem

打开仍在运行的 workflow 子会话时，页面在发布该子会话之前先调用 `session/mode-controls`。控制器把委托 Session 解析到标题路由，再按 root owner 准入。子会话绑定在父会话的路由上，invocation 是 `delegated`，这次读取失败，页面留在父会话。

## Decision

活动中的委托 owner 用 `header.agentPreset` 返回锁定的模式控件，不读取事件，也不占用 root 准入。它的权限控件不可用。`routeForSession` 沿 `header.parentSession` 走到父 root 路由，并用已访问 id 防止父链成环。

## Alternatives considered

**修好路由后再用 `executeSessionOperation` 准入子会话。** 活路径仍要求 invocation 为 `root`，委托 owner 会被拒绝。读取事件还会在子模型流被按住时等待子会话的 writer。

**让 `select` 先发布历史再读控件。** 子会话不是工作区成员时，之后的 root 操作仍会用标题路由。

## Consequences

选中仍在运行的子会话可以显示它的历史，且不取消子回合。该子会话的模式控件是锁定的，不报告 plan-mode 状态。权限控件在它成为 root owner 之前不可用。其他 Session 变更仍走父路由和 root 准入，因此不会把变更应用到子会话本身。

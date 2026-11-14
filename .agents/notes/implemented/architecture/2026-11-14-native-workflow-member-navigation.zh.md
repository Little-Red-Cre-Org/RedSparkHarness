# Agent Note: Native 工作流成员导航

Status: implemented

[English](2026-11-14-native-workflow-member-navigation.md) | 中文

## Problem

`NativeWorkflowRunPanel` 传入空的可导航列表，因此无法从运行披露打开仍在运行的工作流子会话。Cordis 面板在普通会话列表证明该子会话是当前会话的运行中子代理时打开它。

## Decision

`navigableWorkflowMembers` 是共享资格规则：成员仍在运行、子 id 位于普通列表、行来源是 `subagent`、其父级是当前会话，且列表行仍标记运行。Cordis 面板适配 `SessionListState`。Native 转录适配 Host 会话列表，并把得出的 id 与 `select` 一起传入。缺少回调或缺少 id 列表时，行不可交互。

## Alternatives considered

**把每个运行中的成员 id 都当作可导航。** 这会打开普通列表未能证明的子会话。

**从子代理菜单打开子会话。** 该菜单会禁用仍在运行的子会话。工作流行才是打开仍在运行的子会话的路径。

## Consequences

只有列表行证明其为所选会话的运行中子代理时，运行中的成员才出现 Open。选择它走现有的 `select` 路径。Host 对该委托 owner 返回锁定的模式控件，不占用 root 准入，因此页面可以发布子会话且不取消其子回合。不合格的行保持不可交互。

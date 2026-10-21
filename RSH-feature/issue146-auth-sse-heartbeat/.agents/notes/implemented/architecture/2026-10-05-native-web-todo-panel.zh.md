# Agent Note：原生任务列表来自权威 Session 历史

Status: implemented

[English](2026-10-05-native-web-todo-panel.md) | 中文

## Problem

原生 Todo 调用会记录完整任务列表，但原生对话页面此前只呈现可追加的消息事件。用户无法在执行期间或重新打开 Session 后查看当前任务列表。

## Decision

Todo 包提供无 Cordis 的 Client 入口，复用原生 Host 读取器的同一个历史折叠函数。该函数验证持久化列表值，在 todo/write 时替换完整列表，并在权威 turn/start 时清空。完整冷恢复与 fork 继承历史遵循相同规则；turn/end 保留当前列表。

原生对话页面从已接受的 Session 事件呈现本地化只读列表，不拥有任务注册表或写入 API。实时交付和冷恢复保留现有有界传输及 Session 验证。显式 native-web 与原生 Desktop renderer 共用此视图。

## Alternatives considered

Client 任务注册表会复制 Session 权威并丢失冷恢复。发送时清空本地状态会在 Host 准入前删除有效列表。已接受的持久化事件包含完整列表，因此无需新增 Host 投影接口。

## Consequences

任务状态保持与 Provider 无关的持久化值，呈现文案归 locale 所有。面板不贡献提示词、工具或模型输入。任务编辑、丰富工具卡片与 Sidebar 导航仍是独立工作；旧默认装配不变。

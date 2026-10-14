# Agent Note: Native 只读工作流运行展示

Status: implemented

[English](2026-10-14-native-workflow-readonly.md) | 中文

## Problem

Native Session 历史包含工作流事件，但其会话记录需要与 Cordis 工作流节点一致的 阶段身份、成员顺序和终态。Native 尚无用于成员导航的逻辑父子目录或地址契约。

## Decision

[ui-workflow-run](../../../../rsh/Programs/Web/client/ui-workflow-run/README.zh.md) 在 Cordis 适配器与 `./native` 库之间共享 props 驱动的视图和持久事件投影。 Native 按 run-start 序号锚定每个面板，并保留普通工具卡片。连续展示段保持 session-scope 运行的日志顺序，不为其伪造所属 turn。面板身份包含 Session id，折叠选择不会跨 Session 切换保留。只有所属 step 或 turn 已关闭才可推断中断。成员行只读；Session seed/fork 头不提供逻辑子会话导航依据。

## Alternatives considered

**把 Cordis 面板复制到 Native。** 这会重复折叠行为，并使阶段身份或成员状态语义分歧。

**使用 seed/fork 父级元数据导航。** 这些记录描述 Session 来源，不能证明逻辑成员关系 或地址可用性。

## Consequences

Cordis 保留现有的运行中子会话可导航条件与焦点感知折叠。Native 展示相同的持久运行 事实，不新增 Host 接口或执行写入。子会话导航等待所属接口提供后再实现。

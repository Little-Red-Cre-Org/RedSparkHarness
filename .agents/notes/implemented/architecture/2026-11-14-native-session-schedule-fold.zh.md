# Agent Note: Native Session Schedule fold

Status: implemented

[English](2026-11-14-native-session-schedule-fold.md) | 中文

## Problem

Cordis Web 目录从选中 Session 的 `schedule` 投影读取记录，侧栏标记也用同一份数据。Native 目录只读 `scheduler.listSchedules()`；它按 owner 限定，列出的是 task scheduler 的计划，而不是 Schedule 包写入的 `schedule/change` 记录。因此已存的提醒既不产生标题目录，也不产生侧栏标记，播种回放夹具也不会填 scheduler。

## Decision

Host Session 列表用已为行标题和空白状态读取的有界历史折叠 `schedule/change`，并跳过 Session 的 `inheritedEventCount` 之前的前缀。历史读不到或记录解不出时报告 `hasActiveSchedule: false`；列表不会读取第二份日志。

Native 目录订阅 `clientNativeConversation`，用同一规则折叠选中 Session 已加载的事件，再与 scheduler 帧按 id 合并。同 id 时日志行优先。日志行使用浏览器半边的 `formatScheduleFrequency`，频率文本与 Cordis 目录一致。

折叠只读取控制器已加载的事件。目录不扫描持久化 Session，不收养已发布的 root，也不唤醒冷态 owner。这些限制是 Schedule 包的 owner 规则，不是性能优化。

## Alternatives considered

**在 `native-web` 挂载 Schedule 投影插件。** 这正是 Native 客户端要替换掉的 Cordis 实现，而且 runtime owner 只会附加到未来的活动 root。用户打开但没有发送提示的已存 Session 仍然覆盖不到。

**让 `scheduler.listSchedules()` 扫描 Session 日志。** scheduler 按 owner 限定，列表对每个已存 Session 都运行；在那里读取并折叠全部日志会越过 owner 边界，也会重复读取历史。

**只渲染 scheduler 行。** 只存在于持久化 `schedule/change` 流里的提醒会让目录保持为空，包括回放夹具。

## Consequences

已存提醒在 Session 打开时就能出现在标题目录和侧栏标记中，不需要活动的 scheduler owner，也不需要模型请求。日志行是只读的，这本来就是该目录的定位；scheduler 行保留自己的控件。损坏或解不出的记录降级为无标记，而不是让 Session 列表失败；选中 Session 已加载的事件仍是唯一输入。

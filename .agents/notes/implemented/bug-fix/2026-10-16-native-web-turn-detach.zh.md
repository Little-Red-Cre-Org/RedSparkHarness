# Agent Note: 原生 Web 回合在页面断开后继续运行

Status: implemented

[English](2026-10-16-native-web-turn-detach.md) | 中文

## 问题

关闭或刷新原生 Web 页面会取消正在运行的回合，包括等待工具审批的回合（UX 审计 N15）。`session/await` 或 `session/prompt` 长轮询断开时 Host 会中止回合，Client 和对话控制器也会在页面生命周期结束时发送 `session/cancel`。重新打开后，工具行显示调用已中断、结果未知，审批卡片也消失了。在无人等待时结算的回合还会让下一次提示因 "Session already has a pending turn" 被拒绝。

## 决策

回合生命周期归 Host 所有。断开的结算等待者只解除自身绑定；回合继续运行，待处理的审批和问题保持待处理。无人等待时结算的回合会被回收，`session/start` 在已结算且无人等待的回合之后准入下一次提示。

`session/attach { sessionId, lastSeq }` 从 `lastSeq` 重新打开运行中回合的跟随流，重放待处理的人类提示，并返回其 `admissionId`（没有运行中回合时返回 `null`）。随后页面使用既有的 `native-session/follow`、`session/await`、`session/answer-human` 和 `session/cancel` 端点。较新的 attach 会替换较旧的流；没有单独的恢复状态。

Client 只在调用方显式的回合信号上发送 `session/cancel`。Client 生命周期和新的 detach 信号只停止跟随和等待，不取消回合。对话控制器把停止作为回合信号，把页面生命周期作为 detach 信号。恢复所选 Session 时会调用 attach；若有回合在运行，控制器显示发送中状态和停止按钮，并通过与 `send()` 相同的路径观察帧。

## 备选方案

**保留绑定页面的生命周期，只改进中断工具的提示。** 未采用，因为刷新仍会销毁工作和待处理审批，而原版 DSH GUI 会让回合继续运行。

**带独立状态端点的专用恢复状态机。** 未采用，因为一次返回既有准入身份的 attach 调用即可复用跟随、结算、回答和取消端点，无需新增状态。

**每个回合保留多个跟随者。** 未采用，因为每个回合一个页面视图已经足够；较新的 attach 替换较旧的流可保持 Host 流所有权不变。

## 影响

刷新或关闭标签页不再取消 Host 工作，重新打开的页面会恢复实时输出和待处理的审批卡片。页面不再返回的回合会运行到完成，或直到用户在之后的页面中停止它。工具错误展示（N35 的其余部分）保持不变。

## 验证

`native.host.spec.ts` 中的两个 Host 用例固定该契约：断开的提示让其回合继续运行，结算后可准入下一次提示；待处理的审批会重放到 attach 的流上，回答后回合完成。现有的控制器和人类交互控件用例覆盖 `send()` 和会话选择仍能正常结算。

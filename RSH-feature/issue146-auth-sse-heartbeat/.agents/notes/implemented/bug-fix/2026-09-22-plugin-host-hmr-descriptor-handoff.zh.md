# Agent Note: HMR 等待 plugin-host 描述符所有权交接

Status: implemented

[English](2026-09-22-plugin-host-hmr-descriptor-handoff.md) | 中文

## Problem

Cordis 模块 HMR（热模块替换）在插件的 fiber 完成异步释放前移除其 runtime，并立即启动替换 fiber。因此，替换用的 RSH 适配器可能遇到旧的包名预留，即使旧所有者正在退出，也会因名称重复而激活失败。

## Decision

`dsh-plugin-host` 对活动所有者和直接注册继续同步拒绝重复名称。仅当现有预留属于已开始终止释放的 fiber 时，替换适配器才等待。旧所有者的子 fiber 和包装器 fiber 完成清理前，预留仍归旧所有者；等待方随后重新检查所有权，再占用名称。释放操作只移除自身的预留。等待中的 fiber 若已被释放，就不能在旧所有者完成清理后启动子插件。

适配器在启动子插件前注册清理 effect，等待正在进行的子 fiber 释放，并在清理完成后释放描述符。独立的完成任务观察旧包装器 fiber 的结束；包装器自身的清理绝不等待该任务。Cordis 仍是生命周期权威，公开描述符格式与 Loader 配置均不变。更广泛的所有权决策见[运行时适配提案](../../proposed/architecture/2026-09-21-rsh-runtime-layers-and-cordis-adaptation.zh.md)。

## Alternatives considered

**HMR 开始卸载时立即释放包名。** 旧的子 fiber 仍可能拥有 effect，而迟到的 disposer 可能抹去替换插件的注册。等到完全清理后再交接，才能保留独占所有权。

**允许并发重复描述符，或修改 vendored HMR。** 并发所有权会使 `get()` 的结果含糊；修改 vendored 重载机制会影响所有 Cordis 插件，并需要同步上游。适配器自行承担其描述符所需的较窄等待。

## Consequences

适配插件在前任完成终止释放后启动，而第二个活动适配器仍会立即失败。多个替换插件不能同时占用包名。已取消的替换插件不持有预留。直接挂载继续同步拒绝重复名称，不参与仅适用于适配器的 HMR 交接。

包生命周期测试通过阻塞异步 disposer 复现 Cordis 的先删除 registry、再创建替换插件的顺序，检查取消和活动名称重复；Loader 组合另行验证。

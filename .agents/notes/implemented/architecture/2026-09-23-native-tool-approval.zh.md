# Agent Note: 原生工具审批与 Session 审计所有权

Status: implemented

[English](2026-09-23-native-tool-approval.md) | 中文

## Problem

原生 headless 能在存活 Agent 下执行固定和贡献工具，但此前没有可以阻止敏感操作的原生策略服务，也没有把决定与其影响的工具调用关联起来的持久化记录。

## Decision

`@deepseek-ai/dsh-native-approval` 提供原生 `approval` 服务。它接受部署级 `ask` 或 `never` 策略，验证精确登记的原生 Agent，在 `ask` 下分派有序应答者，并返回调用方传入 id 的一次封闭 outcome。Session 所有者会在分派前持久追加 `native-approval/asked` 事件。缺失或失败的应答者会解析为 unavailable；取消会解析为 cancelled；只有 allowed-once 会允许待执行操作。Provider 释放会拒绝新请求、取消应答者工作，并等待其结束。

Provider 不写入 Session。原生 headless 拥有 Session，并在分派前记录 `native-approval/asked`，随后在执行获准操作及生成工具结果前持久记录匹配的 `native-approval/decided`。安装该 Provider 时，它会将服务用于固定 `write_file` 调用，并向原生工具贡献传递同一个授权回调。贡献可声明审批 reason；注册表会在 executor 前调用该回调，受保护贡献没有审批 authority 时会拒绝执行。

原生审计名称与 `approval/asked` 和 `approval/decided` 分离；后两者的 payload 及 Cordis Agent 语义属于既有 user-approval 服务。Session 持久化目录包含原生名称，因此当前读取器能识别原生 profile 的持久化记录，而不会重新解释旧审批数据。

## Alternatives considered

**复用 Cordis user-approval 服务：** 它需要原生 profile 不会构造的 Cordis Agent 和 Session 所有审计路径。

**让 approval Provider 追加 Session 事件：** 这会让策略服务成为应用所有 Session 的第二个写入者，并模糊它与工具结果的顺序。

**把审批处理放进每项工具贡献：** 策略、应答者顺序、取消和持久化审计会在各贡献与固定工具之间分叉。

## Consequences

没有 Provider 时，headless profile 可以保持无人值守：固定写入保留既有行为；已声明受保护的贡献会因 authority 不可用而显式失败。安装 `never` 会产生可审计的确定性拒绝；安装 `ask` 时需要应答者才能授权。Provider 没有浏览器呈现或协议传输，原生审批数据也不替代旧审批历史。

## Verification

原生审批测试覆盖有序委托、缺失应答者、精确 Agent 标识、never 策略拒绝、同步回调失败、调用方取消，以及 Provider 释放时取消并等待应答者工作结束。原生 headless 测试覆盖被拒绝写入的持久化审计、受保护贡献拒绝执行，以及问题在分派前、授权在执行前持久化的顺序。

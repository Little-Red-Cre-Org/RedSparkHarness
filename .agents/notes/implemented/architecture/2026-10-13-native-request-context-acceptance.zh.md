# Agent Note: Native request-context acceptance

Status: implemented

[English](2026-10-13-native-request-context-acceptance.md) | 中文

## Problem

Native request-context Provider 会在请求期间添加模型可见消息，因此其贡献必须使用所选 Program 实际执行的已准入输入和工具注册，同时保留持久 Session 所有权。

## Decision

Native Headless 的 root 与 delegated Program 共用可选 `requestContexts` 服务路径。存在可见 Provider 时，Headless 会在领取排队输入前要求精确活动 Session owner。请求携带该 owner、最终已准入输入、一次 durable event 快照，以及来自实际执行 model 与 PTC 快照的精确注册可见性。Provider 在 Program 执行最终同步准入检查前准备分离消息与候选状态。Program 通过既有 writer 追加 step start、system 消息、已准入输入与 selection、instruction 和 time/tmux 上下文、request-context 消息及 request header/context；随后 flush 精确 owner，注册表才提交准备好的 Provider 状态。即使没有可见 Provider，正常 Program 接受路径仍会执行。

工具可见性按捕获的 registration disposer identity 检查，不另取 catalog snapshot。因此 provider 决策与经过 allowlist、scope shadowing 和 delegated 工具限制后的模型 schema、PTC bindings 保持一致。接受前被拒绝的请求不会提交准备的 Provider 消息或状态。追加或 flush 一旦开始，owner 会排空该写入路径而不回滚。

## Alternatives considered

**通过 `agent.inject` 排队消息。** 该路径要等下一次 inbox claim，无法贡献给已选择输入的当前请求。

**让 Provider 追加或 flush Session。** 这会使每个 Provider 拥有相互竞争的 writer，并使其消息脱离 Program 的最终准入检查与请求事件顺序。

**按名称或独立快照解析工具可见性。** 名称可能指向替代注册；仅用于可见性检查的 snapshot 也可能与实际执行的模型目录或 PTC bindings 不一致，delegated 子集尤其如此。

## Consequences

Provider 负责准备内容与本地候选状态；所选 Program 负责精确 Session、最终准入、顺序追加和 flush。已接受消息会在模型派发前持久化并重建为请求历史。追加一旦开始就无法回滚，因此取消与销毁会排空精确 owner 及已捕获的 Provider 工作。

此契约保持上下文可选。没有可见 request-context Provider 的组合继续使用正常接受路径；存在 Provider 但没有精确活动 owner 时，会在消费排队输入前失败。

详见 [request-context 子系统](../../../../rsh/Docs/subsystems/request-context.zh.md)、[Native Headless](../../../../rsh/Engine/core/native-headless/README.zh.md) 与 [工具执行快照契约](../../../../rsh/Engine/core/native-tools/README.zh.md)。

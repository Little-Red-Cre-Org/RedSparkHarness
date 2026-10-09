# Agent Note: Native Codex app-server product package at 0.161.0

Status: implemented

English | [中文](2026-10-08-native-codex-app-server-0161.zh.md)

## Problem

Native external-subagent requests carry exact parent tool authority and execution ceilings. The Codex 0.161 app-server has no request fields for those per-run constraints, so translating a Native request into deployment-wide permission settings would drop limits or broaden authority. The correctly configured Cordis workspace-write probe remains unverified because the nested product tool returned blocked by policy.

## Decision

@deepseek-ai/dsh-codex-app-server in rsh/Modules/Official/subagent/codex-app-server owns the pinned Codex process, app-server JSON-RPC, ephemeral thread and turn lifecycle, answer selection, safe diagnostics, and teardown. It starts the process through Core childConnection and exports the single startCodexProductRun product API used by the Cordis adapter.

The Native module registers one externalSubagentDriver and refuses every Native request before childConnection.connect(). It does not replace parent authority or positive execution ceilings with permissionMode. Codex 0.161 remains pinned.

@deepseek-ai/dsh-subagent-codex stays a thin Cordis compatibility bridge that maps the legacy SubagentRun contract onto the Official product API; it owns no second protocol or product lifecycle.

## Protocol

A compatibility run initializes one app-server, starts an ephemeral thread, and sends one text-only turn/start. Its adapter passes the provider's deployment-configured model, if any; the request contract has no per-run model or reasoningEffort, so Compat sends no effort. Direct callers of the Official `startCodexProductRun` API may supply optional model and reasoningEffort fields. On unattended approval requests, Compat uses cancel when offered and otherwise decline; unknown request methods fail the run.

The pinned upstream [ThreadStartParams schema](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/app-server-protocol/schema/json/v2/ThreadStartParams.json) carries thread permission fields. [TurnStartParams](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/app-server-protocol/schema/json/v2/TurnStartParams.json) carries effort but no per-run step or token ceiling. The official [CommandExecutionApprovalDecision](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/app-server-protocol/schema/typescript/v2/CommandExecutionApprovalDecision.ts) and [FileChangeApprovalDecision](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/app-server-protocol/schema/typescript/v2/FileChangeApprovalDecision.ts) schemas include cancel and decline.

## Testing

`@openai/codex` remains pinned at `0.161.0`. The existing `native-admission.spec.ts` regression confirms that Native requests are rejected before `childConnection.connect()`, including under full-access permission settings. The Cordis compatibility probe confirms that the requested `workspace-write` value reaches `config.toml`, but the nested product tool returned `blocked by policy`; successful workspace-write execution and inheritance remain unverified.

The source baseline is `main` at `1753cc36d7888375118dca542e69fa6ff58fe019`, which includes SDK PR #124 and its Native authority interface from `98deceb19f`. On this repair worktree, `pnpm run build:lib:host`, targeted `tsc -b --pretty false` checks for both package graphs, and the single `loader-composition.e2e.ts` scenario exited 0; the Loader scenario passed 1/1. A real `pnpm pack` archive contains the public `index.js`, `native.js`, and `wire.js` entries plus their shared chunk. Plain Node imported package root, `/native`, and `/wire` from the extracted archive, resolving dependencies through this worktree's installed pnpm links and Host outputs. This artifact-slice smoke is not an isolated consumer installation or aggregate P4 acceptance. Native requests still refuse before connect, and successful Native execution remains unverified.

## Alternatives considered

- **Use deployment-wide permission settings as Native request authority.** Rejected because those settings cannot preserve the parent's exact per-run grants or execution ceilings.
- **Keep a second Codex process and wire implementation in the Cordis bridge.** Rejected because that would split protocol behavior and lifecycle ownership; the bridge can adapt through startCodexProductRun.

## Consequences

The Cordis compatibility route remains executable, but workspace-write inheritance is unverified. Native Codex currently has zero executable requests; the existing in-process spawn provider remains the executable Native baseline, and the default route is unchanged.

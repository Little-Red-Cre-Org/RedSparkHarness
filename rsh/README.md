---
description: "The DeepSeek Harness package workspace: how the npm packages under rsh/ are grouped, what each group owns, and the conventions that bind them."
kind: "package-group"
---

# Packages

English | [中文](README.zh.md)

## Summary

The harness is assembled from npm packages under `rsh/`, grouped by capability family: sessions and the agent loop, model-facing tools, shell and filesystem execution, web access, subagents, and the rest. Use this page as the top-level map: find the owning group, then open its README for the package list. Every package is scoped `@deepseek-ai/dsh-*` and lives in exactly one group; each group README is the authoritative package map for its family.

## Table of Contents

- [Package groups](#package-groups)
- [Release expectations](#release-expectations)
- [Dependencies](#dependencies)
- [Package README contracts](#package-readme-contracts)
- [Dev Note](#dev-note)

-----

<a id="package-groups"></a>
## Package groups

Every package lives in exactly one group; new packages join existing groups, and a new group updates its own README and this table.

| Group | Role |
|---|---|
| [`core/`](Engine/core/README.md) | Product API spine: sessions, prompts, tools, agent services, and the concrete loop |
| [`api/`](Programs/Web/api/README.md) | Remote BFF assembly and Typert RPC gateway |
| [`typert/`](Core/typert/README.md) | Type graph generation, artifact loading, and runtime registry |
| [`goal/`](Engine/goal/README.md) | Same-session goal persistence and lifecycle |
| [`schedule/`](Engine/schedule/README.md) | Session-local scheduled follow-ups |
| [`automation/`](Modules/Official/automation/README.md) | Persistent plans with independent scheduled Agent executions |
| [`feedback/`](Modules/Official/feedback/README.md) | Human feedback capture and command |
| [`identity/`](Core/identity/README.md) | Shared anonymous identity |
| [`llm/`](Engine/llm/README.md) | LLM capability family: abstract service + provider adapters |
| [`e2b/`](Modules/Official/e2b/README.md) | E2B remote-runtime providers |
| [`subprocess/`](Core/subprocess/README.md) | Subprocess capability family: Service Definition + local process-tree provider |
| [`shell/`](Modules/Official/shell/README.md) | Bash capability family: executor seam, local impl, model-facing tools |
| [`terminal/`](Modules/Official/terminal/README.md) | Persistent PTY capability family: owner-scoped sessions, local implementation, model-facing tools |
| [`code-runtime/`](Modules/Official/code-runtime/README.md) | Code-execution capability family: Service Definition + worker-thread provider + PTC mode Consumer |
| [`sandbox/`](Modules/Official/sandbox/README.md) | Process-confinement seam; bwrap/Landlock/Seatbelt backends |
| [`fs/`](Modules/Official/fs/README.md) | Filesystem capability family: seam, local impl, model-facing file tools, discovery tools |
| [`lsp/`](Modules/Official/lsp/README.md) | LSP capability family: seam, generic stdio provider, and the `lsp` tool |
| [`skill/`](Modules/Official/skill/README.md) | Skill capability family: provider registry, local provider, model-facing catalog/loader |
| [`compaction/`](Engine/compaction/README.md) | Compaction capability family: Service Definition + basic provider + command Consumer |
| [`context/`](Engine/context/README.md) | Model-visible request context: workspace instructions, time context, references |
| [`subagent/`](Engine/subagent/README.md) | Subagent capability family: provider-registry contract and model-facing delegation tools |
| [`jobs/`](Engine/jobs/README.md) | Generic background-job runtime and model-facing job control tools |
| [`experimental/`](Modules/Community/experimental/README.md) | Private prototypes and internal-only plugins |
| [`workflow/`](Engine/workflow/README.md) | Workflow seam, worker-thread engine, and model-facing `workflow`/`ralph` tools |
| [`webhook/`](Modules/Official/webhook/README.md) | Verified external events, trusted rules, and fire-and-forget Workspace Sessions |
| [`web/`](Modules/Official/web/README.md) | Web capability family: seam, search/fetch providers, model-facing web tools |
| [`mcp/`](Modules/Official/mcp/README.md) | MCP client: attach external Model Context Protocol servers so their tools are callable as native tools |
| [`attachment/`](Modules/Official/attachment/README.md) | Durable attachment identity, validation, local content-addressed storage |
| [`spill/`](Modules/Official/spill/README.md) | Spill capability family: storage seam, local impl, tool-result spill policy |
| [`todo/`](Modules/Official/todo/README.md) | The model-facing `todo_write` tool |
| [`plan/`](Modules/Official/plan/README.md) | Plan collaboration state with a direct entry command and reviewed exit |
| [`preset/`](Engine/preset/README.md) | Per-session agent composition from preset `cordis.yml` files |
| [`guard/`](Modules/Official/guard/README.md) | Loop-hygiene guards: advisory repeat-call reminders + the `tools/execute` deadline enforcer |
| [`bundle/`](Compatibility/DSH/bundle/README.md) | Installable `dsh --profile` patch layers |
| [`extensions/`](Modules/Official/extensions/README.md) | Agent runtime self-modification: live plugin/service inspection and model-written mount/unmount |
| [`hooks/`](Modules/Official/hooks/README.md) | Hook bridges + the shared Claude Code / Codex wire-protocol library |
| [`session/`](Engine/session/README.md) | Durable session data plane: persistence seam + backends, projection seam, log-backed titles, session reporting |
| [`session-query/`](Engine/session-query/README.md) | Session retrieval family: logical corpus, bounded reads, lineage, semantic filtering, SQLite full-text search |
| [`settings/`](Modules/Official/settings/README.md) | User-settings seam + file-backed provider |
| [`credentials/`](Modules/Official/credentials/README.md) | Credential-reference and credential-record seam + env-over-`.env` provider + authorization flows that ask a human |
| [`storage/`](Core/storage/README.md) | Non-session storage hub + backends + domain form |
| [`workspace/`](Modules/Official/workspace/README.md) | Workspace entity |
| [`sdk/`](Programs/SDK/packages/README.md) | Out-of-process SDK: JSON-RPC protocol and TypeScript client/server |
| [`acp/`](Programs/ACP/packages/README.md) | Automation-only Agent Client Protocol server |
| [`cli/`](Programs/CLI/README.md) | Profile-only command-line application launcher |
| [`interaction/`](Modules/Official/interaction/README.md) | Human-collaboration plane: approval/interaction seams, permission preset, commands, ask-user tool |
| [`boot/`](Compatibility/DSH/boot/README.md) | Shared app-bin boot glue |
| [`host/`](Programs/Web/host/README.md) | Web-GUI host half: API gateway + HTTP route server |
| [`client/`](Programs/Web/client/README.md) | Web-GUI browser half: shell, wire, object services, slots, `ui-*` plugins |
| [`test-support/`](Tests/test-support/README.md) | Support infrastructure (testkits, invariants, replay, Loader smokes) |
| [`runtime-diagnostics/`](Core/runtime-diagnostics/README.md) | Runtime diagnostics: package-owned invariant checks and reports |
| [`util/`](Core/util/README.md) | Low-level zero-dependency utilities shared across groups (`Branded<B>`, home/path helpers, timeout, retention) |

-----

<a id="release-expectations"></a>
## Release expectations

Most groups are product — stable API. The exceptions: `e2b/` is a POC, `experimental/` is unreleased, and `test-support/`, `runtime-diagnostics/`, and `util/` are support with lower compatibility expectations.

-----

<a id="dependencies"></a>
## Dependencies

The dependency graph is generated: [rsh/Docs/module-graph.md](Docs/module-graph.md) (`pnpm run gen-module-graph`, freshness-gated in CI).

**Extension plugins depend on Service Definitions, never concrete providers.** `dsh-agent-loop` is swappable; UI, hook, and tool plugins use `dsh-agent`. Composition bundles may depend on spine plugins. Capabilities separate Service Definition / Service Provider / Consumer roles when they evolve independently; see [capability seams](../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md). `dsh.runtime` records a package's RSH role; the runtime-layer constraint check rejects Core-to-product dependencies and concrete Provider coupling while preserving reviewed composition and transition edges.

-----

<a id="package-readme-contracts"></a>
## Package README contracts

Every package README covers purpose, configuration, extension points, and [Model Experience](Docs/cookbook/adding-a-package.md#4-write-the-package-readme) unless the model-agnostic [omission allowlist](Scripts/verify-package-readme-model-experience.ts) exempts it. It also carries `## Known Limitations and Deferred Work` or uses its [allowlist](Scripts/verify-package-readme-limitations.ts). Package conventions — exports, service access, invariants, tests — live in [rsh/AGENTS.md](AGENTS.md).

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

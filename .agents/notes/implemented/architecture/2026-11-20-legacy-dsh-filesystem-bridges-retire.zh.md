# Agent Note：旧 DSH 文件系统 bridge 退役，由 Native Provider 接管

Status: implemented

[English](2026-11-20-legacy-dsh-filesystem-bridges-retire.md) | 中文

## 问题

`Compatibility/DSH/bridge` 仍在维护五个包，把旧 DSH 文件系统插件桥接进原生 profile：`compat-dsh-runtime`（共享 Cordis Context 加 allowlist Loader）、`compat-fs-local`、`compat-fs-policy`、`compat-fs-sandbox` 和 `compat-tool-fs`。它们构成一座封闭孤岛：孤岛之外的所有引用都来自孤岛自身、它的两个测试，或生成式目录文档。`snapshots/compat` 通过仅测试用的 `compat` CLI profile 回放 `compat-tool-fs`，`packed-compat-bridge.e2e.ts` 从打包安装覆盖同一组合。没有任何已发布的 `dsh` profile 模板选用它们。

原生侧本就提供同一能力族：`rsh-fs-local`、`rsh-fs-observation-policy`、`rsh-fs-sandbox`、`rsh-native-sandbox-policy` 与 `rsh-tool-fs`；后者的 `read`、`write`、`edit` 工具正承载旧适配器所转发的 schema。

## 决定

退役这座孤岛，不再维护第二条文件系统接线路径。五个包、仅测试用的 `compat` CLI profile、`snapshots/compat` 与 `packed-compat-bridge.e2e.ts` 一并删除，避免任何测试继续支撑已退役的适配器。原生 profile 继续从 `native-profile-template.ts` 直接选择原生 Provider——compat 行从未进入该文件。

bridge README 现在说明文件系统子系统由原生 profile 直接选择，`session-snapshot-corpus.corpus.ts` 移除 `compat` 快照 profile。`compat-plugin-host` 保留：它不属于该孤岛，兼容 bundle 与原生文件系统模块仍在引用它。

## 后果

兼容 bridge 组失去其共享 Cordis Context 和文件系统适配器；剩余条目为声明包、Settings 适配器与 Codex 子 agent 适配器。文件系统工具的录制覆盖现在只来自 `snapshots/native-headless`，它驱动产品实际发布的原生 Provider。

原生 profile 不损失能力：每个退役适配器都转发到已发布 profile 已选择的原生 Provider 或工具。若某 profile 曾通过 `compat-dsh-runtime` 安装旧 DSH 文件系统插件，则没有替代路径，必须改为选择原生 Provider。

## 备选方案

**保留 `compat-dsh-runtime` 作为迁移路径。** 否决：围绕它构建安装计划需要那些已退役的文件系统适配器，而它们是该 allowlist 的唯一条目。

**把适配器改写成原生插件。** 否决：这会重复 `rsh-fs-local`、`rsh-fs-observation-policy`、`rsh-fs-sandbox` 与 `rsh-tool-fs`，而这些包已经拥有相应角色，并有各自的测试与快照。

**只删快照、保留包。** 否决：没有 profile、没有测试的适配器仍是死代码，且继续引入 Cordis。

## 验证

- `pnpm run build`、`pnpm run typecheck` 与 `pnpm run lint` 通过。
- `pnpm run verify-runtime-closure:native-cli` 通过，覆盖 274 个包；`pnpm run verify-runtime-closure` 通过，覆盖 149 个包。
- `pnpm run verify-native-dependencies`、`verify-optional-dependency-imports`、`constraints`、`verify-package-dependencies` 与 `verify-cordis-config` 通过。
- `pnpm run doc-sync` 通过全部 33 项 gate。
- `pnpm run test` 报告 183 个失败，`pnpm run test:snapshot` 报告 8 个，与当前环境中 `origin/main` 检出完全同名；没有新增失败名。

# Agent Note: 恢复发布与静态门禁基线

Status: implemented

[English](2026-11-19-gate-baseline-repair.md) | 中文

## Problem

当前 PR 工作流（`redspark-ci.yml`）会运行包发布规则和构建，但既不运行 `check:ci:static` 聚合，也不运行 `hygiene`。在 `c226914203` 的 `main` 上，这里涉及的五条门禁命令全部失败：`publint`、`verify-optional-dependency-imports`、`verify-cordis-config`、`verify-runtime-closure` 与 `verify-publish-payload`。`rescope-vendor:check` 同样失败。这些失败混合了真实的 payload、清单与文档缺陷和一条刻意保持红色的迁移守卫。

payload 缺陷是具体的：三个 hook 包发出了未列入 `files` 的 `lib/shared-*.js` chunk；`native-headless` 声明了 `./lifecycle-events` 却没有产出；`native-session` 漏掉了 `jobs-types`；`native-application` 发布的 bundle 导入了 `files` 未包含的 `lib/client/*.module.css`；schedule 示例仍引用已删除的 `@redspark/rsh-time-context`；`rsh` 兼容 bundle 的 patch 引用了未声明的 `@redspark/rsh-tool-subagent`。native-CLI 闭包仍会走到 Cordis，因为 `@redspark/rsh` 在删除变更落地前有意保留 Cordis 超集，以支撑 packed compat-bridge 测试。

`agent-presets` 通过 `new URL('../presets/', import.meta.url)` 访问自己打包的 `presets/` 目录，而该 URL 在 `src` 与各个 `lib/types` 深度上解析结果不同。把 shipped root 内联成模块常量又会把 `discovery.ts` 的可选 Cordis peer 拉进 `native-storage.ts`。`tool-str-replace-editor` 导入 `@redspark/rsh-fs/native` 与 `@redspark/rsh-sandbox/native`，却把这两个 peer 声明为可选。最后，`rsh/Core/vendor/README.md` 仍在描述已退役的 `@deepseek-ai` scope，而 rescope codemod 的 token 规则会改写 tarball 解压内容和一个 `node_modules` 路径片段。

## Decision

payload 和清单缺陷直接修复：发布或声明已产出的 chunk、入口、CSS 与 bundle patch 依赖。`verify-publish-payload` 现在只对 `dsh.native.targets` 含 `host` 的 Native 入口执行裸说明符安装规则。Client-only Native 入口是静态链接的浏览器库：Web shell 构建会解析其裸导入，`rsh/Programs/Web/client/AGENTS.md` 将这些浏览器构建输入保留在 `devDependencies`。同一门禁还豁免那些只在 TypeScript 源码启动分支读取的精确 `.ts` URL，因为 tsdown 无法折叠 `import.meta.url` 扩展名判断，而该分支在 payload 中不可达。

`verify-runtime-closure` 保留 Python runtime 遍历。native-CLI 遍历移到独立的 `verify-runtime-closure:native-cli` 命令，作为 Cordis 删除的验收检查。把该目标留在默认命令中会让基线在 `@redspark/rsh` 有意保留 Cordis 期间持续为红。

`agent-presets/src/shipped-root.ts` 持有 `SHIPPED_PRESET_ROOT`，由 `import.meta.resolve('@redspark/rsh-agent-presets/package.json')` 一次解析；`discovery.ts` 重新导出，`native-storage.ts` 导入该叶子模块，使 Host 面不会加载 discovery 模块的可选 peer。`tool-str-replace-editor` 把 `@redspark/rsh-fs` 与 `@redspark/rsh-sandbox` 声明为必需 peer，`native-package-policy` 把剩下的 `@redspark/rsh-tools` 导入记为 compatibility-only。vendor README 现在写明 `@redspark` scope，rescope codemod 跳过那些裸 `cordis` token 属于 payload 与路径内容而非说明符的 Desktop 测试。

## Verification

- 重建后的树上，`pnpm run publint`、`pnpm run verify-cordis-config`、`pnpm run verify-runtime-closure`、`pnpm run verify-publish-payload`、`pnpm run constraints` 与 `pnpm run verify-package-dependencies` 均通过。
- `pnpm run verify-optional-dependency-imports`、`pnpm run verify-native-dependencies` 与 `pnpm run rescope-vendor:check` 通过。
- `pnpm run hygiene` 的 18 条门禁全部通过。
- `verify-publish-payload` 报告 214 个带 Native 入口的打包包，其 payload 内所有说明符均可解析。
- `npx vitest run rsh/Scripts/verify-publish-payload.spec.ts` 通过 42 个测试，覆盖 Client-only 范围、Host-target 反例与精确的源码模式豁免。
- 在 Cordis 删除前，`pnpm run verify-runtime-closure:native-cli` 仍是被记录的红色守卫。

## Alternatives considered

### 为什么不在本次变更中删除 Cordis？

删除还会移除兼容 bundle，并让 packed compat-bridge 测试不再依赖 Cordis。把该迁移混入基线修复，会使门禁修复与删除无法独立评审或回退。

### 为什么不让 native-CLI 遍历留在默认命令中？

该遍历是尚未落地迁移的验收检查。一个必须等到后续变更才能通过的默认命令不是可用的基线信号，而且会让其他闭包回归都藏在已知的 Cordis 失败之后。

### 为什么不发布 `src/` 或仓库 tsconfig？

两者都不是消费者产物。`./src/*` 导出服务于工作区测试与源码启动；把源码树加入发布 tarball 会扩大 payload 并发布未构建代码。源码模式 URL 对消费者没有任何意义。

## Consequences

- `main` 上的静态与发布门禁重新可信，Cordis 删除可以从绿色基线开始。
- native-CLI 闭包仍需显式运行，其红色结果就是迁移剩余工作清单。
- Client-only Native 入口不再需要把浏览器构建输入重复声明为安装依赖，从而与 Client 依赖策略保持一致。

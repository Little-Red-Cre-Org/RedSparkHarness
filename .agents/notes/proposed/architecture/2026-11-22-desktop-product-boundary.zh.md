# Agent Note: Desktop is the only independent product entry

Status: proposed

[English](2026-11-22-desktop-product-boundary.md) | 中文

## Problem

Desktop 是唯一的官方用户入口和正式发行（`pnpm run start:desktop`、`pnpm run package:desktop:*`）。[Desktop-only retires the browser Web deployment](../../implemented/architecture/2026-11-21-desktop-only-retires-browser-web.zh.md) 已经拒绝 `--profile web` 与 `--from-default-profile web`，并且 Desktop 只启动 Native profile。树里仍有历史或独立入口：Cordis Web 组合包、`profile: web` 快照、TUI、其他 `dsh` profile、SDK 与 ACP（Agent Client Protocol）包，以及 Typert Remote Web。把这些入口当成并列产品，或在前置条件成立前删除它们，都会把仓库说错。

在本次改动之前，[Cordis cleanup keeps the legacy writers and three packages](2026-11-15-cordis-cleanup-keeps-legacy-writers.zh.md) 仍写着桌面端与 Web 的保留成立。这句话与已经交付的 Desktop 只启动 Native、以及被拒绝的浏览器启动相矛盾。本次改动让该说明与已交付行为一致。Cordis 清理没有结束。本说明不开始快照迁移，也不开始入口退役。

## Proposal

记下当前入口、以后可以迁移或删除的对象，以及这次必须留下的部分。快照迁移要等本清单和与它一起送出的其他文档改动合并之后。独立入口的退役是本清单合并之后的下一步。这次只改文档。

### 顺序

下面的计数是迁移输入，不是修改 `snapshots/` 的许可。保留清单不是第二套产品。Desktop 依赖尚未证实的入口留下，删除标为尚未核实。

### `profile: web` 快照

计数单位是一个 `snapshot.yml`。在这棵树上，32 个文件声明 `profile: web`。这与 `3e9c3bd` 的计划计数一致。每一条都在 `snapshots/web/` 下。2026-11-15 测得的 34 不是当前计数。

- `snapshots/web/approval-composer/snapshot.yml`
- `snapshots/web/background-job-list/snapshot.yml`
- `snapshots/web/details-session-lifecycle/snapshot.yml`
- `snapshots/web/document-preview/snapshot.yml`
- `snapshots/web/feedback-command/snapshot.yml`
- `snapshots/web/feedback-release/snapshot.yml`
- `snapshots/web/file-upload-round/snapshot.yml`
- `snapshots/web/fresh-round-trip/snapshot.yml`
- `snapshots/web/goal-multi-turn-actions/snapshot.yml`
- `snapshots/web/lifecycle-chrome/snapshot.yml`
- `snapshots/web/live-interactions/snapshot.yml`
- `snapshots/web/message-actions/snapshot.yml`
- `snapshots/web/message-feedback-protocol/snapshot.yml`
- `snapshots/web/navigation-panes/snapshot.yml`
- `snapshots/web/open-in-app-ssh/snapshot.yml`
- `snapshots/web/permission-policy-context/snapshot.yml`
- `snapshots/web/plan-narrow-viewport/snapshot.yml`
- `snapshots/web/plan-review/snapshot.yml`
- `snapshots/web/present-svg/snapshot.yml`
- `snapshots/web/preset-migration/snapshot.yml`
- `snapshots/web/pwsh-terminal/snapshot.yml`
- `snapshots/web/question-composer/snapshot.yml`
- `snapshots/web/queue-actions/snapshot.yml`
- `snapshots/web/queued-image/snapshot.yml`
- `snapshots/web/seeded-history/snapshot.yml`
- `snapshots/web/sidebar-scrollbar/snapshot.yml`
- `snapshots/web/steering/snapshot.yml`
- `snapshots/web/subagent-conversation/snapshot.yml`
- `snapshots/web/subagent-interrupt/snapshot.yml`
- `snapshots/web/turn-tail-actions/snapshot.yml`
- `snapshots/web/web-search-round/snapshot.yml`
- `snapshots/web/workspace-management/snapshot.yml`

`snapshots/web/` 有 45 个场景目录。下面 13 个 `snapshot.yml` 不声明 `profile: web`。每个都声明 `profile: native-web`。它们不属于这 32 个，本清单也不把它们排进 `profile: web` 迁移。

- `snapshots/web/bash-abort-row/snapshot.yml` — `native-web`
- `snapshots/web/minimal-preset/snapshot.yml` — `native-web`
- `snapshots/web/native-conversation/snapshot.yml` — `native-web`
- `snapshots/web/native-feedback/snapshot.yml` — `native-web`
- `snapshots/web/native-github-webhook/snapshot.yml` — `native-web`
- `snapshots/web/native-question-cancel/snapshot.yml` — `native-web`
- `snapshots/web/native-session-core/snapshot.yml` — `native-web`
- `snapshots/web/native-session-grant/snapshot.yml` — `native-web`
- `snapshots/web/present/snapshot.yml` — `native-web`
- `snapshots/web/ptc-round/snapshot.yml` — `native-web`
- `snapshots/web/schedule-catalog/snapshot.yml` — `native-web`
- `snapshots/web/skill-tool-row/snapshot.yml` — `native-web`
- `snapshots/web/workflow-run/snapshot.yml` — `native-web`

`snapshots/desktop/native-session-core/snapshot.yml` 声明 `profile: desktop`。它留在 Desktop。以后的快照工作不把它改判成浏览器场景。

以后的动作：在另一次改动里迁移或明确退役这 32 个文件。前置条件：本清单和与它一起送出的其他文档改动已经合并，并且 Desktop-only 说明记录的 Native 缺口要么已经实现，要么按场景写明。所有者：快照场景，不是 Desktop shell。阻塞：若干场景仍在走 Cordis 浏览器组合。保留理由：在这一批之前删除这些文件，或在这次改动里改 `profile:`，会在该批次之前丢掉覆盖。

### 浏览器 Web 残留

受支持的浏览器启动已经被拒绝。`rsh/Programs/CLI/src/args.ts` 拒绝 `--profile web` 与 `--from-default-profile web`，并指向 `rsh/Docs/native-config-migration.md`。位置参数 `web` 不是 profile：`parseRshArgs` 要求 `--profile`，并在启动前退出。没有 `web` 子命令。`rsh/Programs/CLI/package.json` 的 `dsh.nativeProfileTemplates` 不含 `web`。

根 `package.json` 的 `demo:inspector` 仍会运行 `rsh/Programs/CLI/src/bin.ts web`，并带上 `rsh/Modules/Community/experimental/inspector` 下的 patch。该调用不传 `--profile`，所以当前解析器会拒绝它。以后的动作：当 inspector 包的测试不再需要浏览器宿主时，删除或改指这个脚本。前置条件：没有受支持的流程把 `demo:inspector` 写成产品入口。所有者：根脚本与 `@redspark/rsh-experimental-inspector`。阻塞：inspector 包仍有自己的测试，[2026-11-15 清理说明](2026-11-15-cordis-cleanup-keeps-legacy-writers.zh.md) 保留这些测试。保留理由：删除这个包是 Cordis 清理的决定，不是 README 修正。

`pnpm run dev:web` 运行 `rsh/Scripts/dev-web.ts`。该脚本重建浏览器产物。它的注释仍写着由 `dsh web` 提供这些产物。以后的动作：与浏览器测试路径一起改指或删除该脚本。前置条件：没有测试或贡献者流程还需要这个监视循环。所有者：根脚本。阻塞：`rsh/Programs/Web/application/tests/hmr-live.e2e.ts` 会等待 `pnpm run dev:web`。保留理由：该脚本仍是可调用的开发命令，这次不改测试。

`@redspark/rsh-web-app`（`rsh/Compatibility/DSH/bundle/web-app`）和 `@redspark/rsh-web-compatibility`（`rsh/Compatibility/DSH/web/frontend`）是公开包。`@redspark/rsh-host-webserver`（`rsh/Programs/Web/host/webserver`）和 `@redspark/rsh-host-frontend-static`（`rsh/Programs/Web/host/frontend-static`）是公开包，Cordis 浏览器组合包靠它们提供页面。以后的动作：只与浏览器测试路径一起删除这四个包：`@redspark/rsh-web-app`、`@redspark/rsh-web-compatibility`、`@redspark/rsh-host-webserver` 和 `@redspark/rsh-host-frontend-static`。前置条件：没有快照、测试或 Desktop 包 manifest 再加载它们。所有者：`rsh/Compatibility/DSH`。阻塞：`rsh/Programs/Web/application/tests/scaffold.ts`、`assembled-boot.ts` 和 `schedule-after.e2e.ts` 仍加载 `rsh/Compatibility/DSH/bundle/web-app/cordis.patch.yml`。`smoke-real.e2e.ts` 向 `rsh/Programs/CLI/src/bin.ts` 传入位置参数 `web`，`hmr-live.e2e.ts` 向 `rsh/Programs/CLI/lib/bin.js` 传入同一参数，并等待 `pnpm run dev:web`。`parseRshArgs` 在启动前拒绝该参数。`@redspark/rsh-desktop` 与 `@redspark/rsh-desktop-host` 自己的依赖列表没有点名 `@redspark/rsh-web-app`。保留理由：scaffold 和这 32 个快照仍指向该 Cordis 组合。在这里删除这四个包，等于把尚未完成的退役说成已经完成。

- `@redspark/rsh-base`（`rsh/Compatibility/DSH/bundle/base`）仍会发布，并且不属于浏览器测试路径的删除集合。它仍在 `rsh/Programs/Desktop/src/project-manager.ts` 的 Desktop starter bundle 列表上，与 `@redspark/rsh-web-app` 并列。[架构](../../../../rsh/Docs/architecture.zh.md) 仍把它写成 legacy `headless`、`sdk` 与 `acp` profile 的共享第一层。以后的动作：先核实非浏览器消费者。核实完成前不删除。
- `@redspark/rsh-headless`（`rsh/Compatibility/DSH/bundle/headless`）仍会发布，并且不属于浏览器测试路径的删除集合。以后的动作：先核实非浏览器消费者。核实完成前不删除。
- `@redspark/rsh-rsh`（`rsh/Compatibility/DSH/bundle/rsh`）仍会发布，并且不属于浏览器测试路径的删除集合。以后的动作：先核实非浏览器消费者。核实完成前不删除。
- `@redspark/rsh-sdk-app`（`rsh/Compatibility/DSH/bundle/sdk-app`）仍会发布，并且不属于浏览器测试路径的删除集合。以后的动作：先核实非浏览器消费者。核实完成前不删除。
- `@redspark/rsh-acp-app`（`rsh/Compatibility/DSH/bundle/acp-app`）仍会发布，并且不属于浏览器测试路径的删除集合。以后的动作：先核实非浏览器消费者。核实完成前不删除。
- `@redspark/rsh-sdk-minimal`（`rsh/Compatibility/DSH/bundle/sdk-minimal`）仍会发布，并且不属于浏览器测试路径的删除集合。以后的动作：先核实非浏览器消费者。核实完成前不删除。

### TUI

`rsh/Programs/TUI/native-tui`（`@redspark/rsh-native-tui`）和 `rsh/Programs/TUI/terminal-ui`（`@redspark/rsh-terminal-ui`）是公开包。`rsh/Programs/CLI/src/native-profile-template.ts` 把已发布名字 `rsh` 映射到 `native-tui`。帮助文本仍显示 `dsh --profile rsh`。`@redspark/rsh` 依赖 `@redspark/rsh-native-tui`。以后的动作：把 `rsh` / `native-tui` 作为独立用户入口退役。前置条件：CLI manifest 不再为 Desktop 不加载的 profile 需要这个包，或一次实测的 Desktop 启动表明该依赖未被使用。所有者：`rsh/Programs/TUI`，不是 Desktop shell。阻塞：`@redspark/rsh` 的依赖已经声明；Desktop Host 进程是否加载 TUI 插件尚未核实。保留理由：这次不删除源码，也不把 TUI 写成当前官方产品入口或长期并列产品。

### CLI profile

`rsh/Programs/CLI/package.json` 的 `dsh.nativeProfileTemplates` 列出 12 个名字：`headless`、`sdk`、`acp`、`rsh`、`native-headless`、`native-sdk`、`native-sdk-dsh-child`、`native-web`、`native-acp`、`native-acp-dsh-child`、`native-tui` 和 `native-headless-query`。别名在 `rsh/Programs/CLI/src/native-profile-template.ts` 的 `STANDARD_PROFILE_COMPOSITIONS`。[CLI boots only Native profiles](../../implemented/architecture/2026-11-19-cli-native-only-boot-and-legacy-retirement.zh.md) 是启动规则。编程工具包不在这次退役范围内：`@redspark/rsh-hooks-codex`、`@redspark/rsh-codex-app-server` 和 `@redspark/rsh-subagent-codex`。这棵树没有 Antigravity 包或目录。`prepare:dsh`（`rsh/Programs/Desktop/scripts/prepare-dsh.ts`，`@redspark/rsh-desktop` 上的脚本）在 Desktop 打包前生成生产运行时，并且留下。

| 名字 | 分类 | 当前行为 | 以后的动作 |
|---|---|---|---|
| `headless`、`native-headless` | 作为测试与开发者启动器保留 | `headless` 别名到 `native-headless`。帮助文本和根 `AGENTS.md` 提供它。83 个快照声明 `profile: headless`，21 个声明 `profile: native-headless`。`@redspark/rsh` 依赖 `@redspark/rsh-native-headless`。 | 保留测试入口。它不是官方 Desktop 并列产品。 |
| `native-headless-query` | 与 headless 一起保留 | 已发布模板，带 SQLite session-query 行。`snapshots/native-headless-query/session-query/snapshot.yml` 声明它。 | 保留，直到 headless 测试工具的所有者另作决定。 |
| `native-web` | 保留 | 桌面渲染层的已发布模板。通过 `pnpm dsh --profile native-web` 在回环地址上检查。Desktop 新建 profile 请求这个 client 模板。 | 保留。不是独立的浏览器产品。 |
| `rsh`、`native-tui` | 独立用户入口 | 别名与公开 TUI 包，见 TUI 一节。 | 以后退役该用户入口。先不删除这些包。 |
| `sdk`、`native-sdk` | 独立启动；删除尚未核实 | `sdk` 别名到 `native-sdk`。SDK client 的 native 入口固定该 profile，并解析 `dsh`。 | 不删除。不是长期并列产品。 |
| `native-sdk-dsh-child` | CLI 私有的子进程启动器 | 不是帮助文本里的用户名字。CLI 测试和 SDK 子进程路径启动它。 | 在 SDK 子进程执行还在时保留。 |
| `acp`、`native-acp` | 独立启动；删除尚未核实 | `acp` 别名到 `native-acp`。 | 不删除。不是长期并列产品。 |
| `native-acp-dsh-child` | CLI 私有的子进程启动器 | `rsh/Programs/CLI/src/native-acp-child-runtime-launcher.ts` 传入这个 profile。 | 在 ACP 子进程执行还在时保留。 |
| `web` | 已退役的启动名 | 不在模板列表里。`args.ts` 拒绝它。 | 不恢复。 |
| `sdk-minimal` | 已退役的启动名 | `args.ts` 拒绝它。`@redspark/rsh-sdk-minimal` 仍会发布。 | 先核实非浏览器消费者，核实完成前不删除。 |

### Remote 与 Typert

Typert Remote Web 随 Cordis 退役。[Typert retires with Cordis](2026-11-17-typert-retires-with-cordis.zh.md) 拥有删除清单：`rsh/Core/typert/generator`、`rsh/Core/typert/loader`、`rsh/Core/typert/protocol`、`rsh/Core/typert/registry`、`rsh/Programs/Web/api/gateway`（`@redspark/rsh-api-gateway`）和 `rsh/Programs/Web/api/remotes`（`@redspark/rsh-api-remotes`）。这些目录仍在。以后的动作：在该说明点名的 Cordis 包删除阶段删除它们，不在这次。前置条件：该说明的验收标准。所有者：Typert 与旧 Web 控制器。阻塞：生产类仍继承 `TypertRemoteService`，包括 `rsh/Programs/Web/host/plugin-inventory/src/index.ts`。保留理由：在 Native 所有者成为唯一调用方之前删除生成器或 gateway，会留下没有服务端的生成客户端。

不要删除 Native Connection registry，也不要删除 native-web host 传输。`@redspark/rsh-client-connection` 从 `rsh/Programs/Web/client/connection` 导出 `./native-host`。`@redspark/rsh-native-web-host`（`rsh/Programs/Web/host/native-web-host`）和 `@redspark/rsh-native-web-assets` 为 Desktop 渲染层提供页面。它们留在 Desktop 链上。

### npm 发布与 Desktop 打包

`rsh/Scripts/verify-publish-payload.ts` 没有固定的包允许列表。它打包每一个 `exports` 含 `./native` 的非 private 工作区包，然后检查 tarball 里的裸说明符能否从会安装的依赖节解析。在这棵树上，这个选择是 209 个包。`@redspark/rsh-desktop` 与 `@redspark/rsh-desktop-host` 是 `private: true`，所以这项检查不打包它们。

`pnpm run release:publish` 运行 `rsh/Scripts/release/publish.ts`，发布一个已打包的族。`rsh/Scripts/release/families.ts` 定义 `dsh` 与 `vendor`。`dsh` 成员是由 `RELEASE_MANIFEST_GLOBS`、`rsh/Programs/*/package.json`、`rsh/Programs/Web/application/package.json`，或 `rsh/Scripts/experimental-package-policy.ts` 里的 `PUBLIC_EXPERIMENTAL_PACKAGE_DIRECTORIES`（仅 Agent Teams）匹配到的非 private manifest。安装入口是 `@redspark/rsh` 的 `lib/bin.js`。vendor 族是 `rsh/Core/vendor/*`，不是 Desktop 产品。这个族仍发布的公开独立入口包括 `@redspark/rsh`、`@redspark/rsh-native-tui`、`@redspark/rsh-terminal-ui`、`@redspark/rsh-sdk-client`、`@redspark/rsh-native-sdk-server`、`@redspark/rsh-sdk-jsonrpc-server`、`@redspark/rsh-acp`、`@redspark/rsh-native-acp`、`@redspark/rsh-web-app`、`@redspark/rsh-base` 和 `@redspark/rsh-web-compatibility`。`@redspark/rsh-web-frontend` 是公开包，因为桌面渲染层构建使用它；它不是第二个产品。

Desktop 打包留下。根脚本 `start:desktop` 与 `package:desktop:*` 委托给 `@redspark/rsh-desktop`。`rsh/Programs/Desktop/src/core-package-set.ts` 把 `@redspark/rsh` 和 `@redspark/rsh-desktop-host` 放进 `RELEASE_PACKAGES`，要求 `assembly: native`，并把 `@redspark/cordis` 列在 `CORDIS_RUNTIME_PACKAGES` 里作为插件内核。同一文件写明 loader 与组合包不在该内核列表里。以后的动作：这次没有。不要为了藏起公开 CLI 而从 Desktop 包集合里去掉 `@redspark/rsh`。

### 留下的 Desktop 链

这些不是删除候选：

- `rsh/Programs/Web/client/**` 下的 Web client 源码，包括 `rsh/Programs/Web/client/web` 的 Native 启动。
- `rsh/Programs/CLI/src/native-profile-template.ts` 里的 `native-web` profile 模板。
- `rsh/Programs/Web/host/native-web-assets` 的 `@redspark/rsh-native-web-assets`。
- `rsh/Programs/Web/host/native-web-host` 的 `@redspark/rsh-native-web-host`。
- `rsh/Programs/Web/api/native-web-session-controller` 的 `@redspark/rsh-native-web-session-controller`。
- `rsh/Programs/DesktopHost` 的 `@redspark/rsh-desktop-host`，以及捆绑运行时加载的 `rsh/Engine`。
- Desktop host 调用的 Native API 控制器。这项保留不包括 `rsh/Programs/Web/api/gateway` 或 `rsh/Programs/Web/api/remotes`。
- `rsh/Programs/Desktop/scripts/prepare-dsh.ts` 的 `prepare:dsh`。

`@redspark/rsh-desktop` 是 private 的，它是 Electron shell。它是产品包，不是 npm 产品入口。

### SDK、ACP 与 headless

SDK 与 ACP 今天是独立启动入口：`dsh --profile sdk` 与 `dsh --profile acp`，公开包在 `rsh/Programs/SDK/packages/` 与 `rsh/Programs/ACP/packages/`。`@redspark/rsh-desktop` 不依赖这些包名。`@redspark/rsh-desktop-host` 依赖 `@redspark/rsh`，而该 manifest 依赖 `@redspark/rsh-native-sdk-server`、`@redspark/rsh-sdk-protocol`、`@redspark/rsh-sdk-runtime`、`@redspark/rsh-sdk-child`、`@redspark/rsh-native-acp`、`@redspark/rsh-acp-protocol`、`@redspark/rsh-acp-child`、`@redspark/rsh-native-tui` 和 `@redspark/rsh-native-headless`。Desktop Host 进程是否加载 SDK、ACP 或 TUI 插件尚未核实。以后的动作：只有在证实该加载未被使用，或 CLI 依赖被拆开之后，才决定产品退役。不要删除这些包。不要把 SDK、ACP 或 headless 写成长期并列产品。

Headless 是测试与开发者启动器（根 `AGENTS.md` 里的 `pnpm dsh --profile headless`，加上面的快照计数）。即使帮助文本也把它展示给用户，仍保留该入口。`rsh/Programs/SDK/python/sdk-runtime`（`dsh-python-runtime-closure`）是 `private: true`，并且仍点名 Cordis 包；2026-11-15 说明保留这个 closure。本清单不重新测量它。

### 历史记录

不要为了让产品句子看起来更干净而删除历史。`.agents/notes/archived/` 下的已归档 Agent Note 保持冻结（[归档政策](../../implemented/process/2026-07-26-frozen-agent-note-archive.zh.md)）。Git 历史留下。README 引用保留上游标题和论文 URL。`LICENSING.md` 与 `THIRD_PARTY_NOTICES.md` 里的上游版权和许可证文本留下。monorepo 历史文档留下，直到另一次改动拥有它们仍然需要的事实。

### 故意留在原地的文档

这次不改写常驻架构文档。这些矛盾是故意留下的：

- 根 `AGENTS.md` 仍把仓库描述成全插件 Cordis harness，并记录 `pnpm dsh --profile headless`。
- `rsh/Docs/architecture.md` 把 `dsh --profile native-web`、`headless`、`sdk` 和 `acp` 列为已发布应用。它的 Desktop 一节另行描述 Electron 应用。
- `rsh/Programs/Web/host/native-web-assets/README.md` 仍提到兼容模式预览。
- `rsh/Scripts/dev-web.ts` 的注释仍把 `dsh web` 写成监视已构建产物并触发重载的服务器。
- `rsh/Programs/SDK/packages/client/README.md` 与中文同文件 `README.zh.md` 的第 50 行仍告诉用户用 `dsh --profile legacy-sdk --from-default-profile sdk` 创建 Cordis profile。`rsh/Programs/CLI/src/native-profile-template.ts` 里的 `createNativeProfileFromTemplate` 只写入 `runtime: 'native'`。这次不改这两份 README，也不改这个写入函数。

## Alternatives considered

**在这次改动里删除残留包和快照。** 否决。32 个 `profile: web` 场景和 Web application 测试仍点名 Cordis 浏览器组合。Desktop-only 说明已经记录为什么先删该组合会丢掉覆盖。对照 Desktop Host 所安装的 `@redspark/rsh` 依赖，SDK、ACP 和 TUI 的删除尚未核实。

**把 TUI、Web、SDK 和 Desktop 保持为并列产品。** 否决。正式发行是 Desktop。留在树里的入口是历史或独立入口，不是第二条受支持的产品线。未证实的依赖保持为尚未核实，这不等于把它们收成永久产品。

**归档或否决 2026-11-15 清理说明。** 否决。Cordis 清理没有结束，所以该说明保持 proposed。本清单是部分取代：两份说明都留下，并且互相链接。Desktop-only 说明保持 implemented，因为它记录已经交付的 Native 装配和启动拒绝。

**在这里改写 `rsh/Docs/architecture.md` 和根 `AGENTS.md`。** 否决。这两个文件是架构地图和常驻命令。上面列出了互相矛盾的产品句子，以便以后的文档改动拥有它们。这次不改这两个文件。

## Acceptance criteria

- 这里列出 32 个 `profile: web` 路径，以及 13 个声明 `native-web` 的 `snapshots/web/` 路径，并且计数与这棵树上的重新枚举一致。
- README 写明 Desktop 是唯一的官方用户入口，`native-web` 用于开发和检查，并且 TUI、其他 CLI profile、SDK、ACP，以及残留的 Web 与 Remote 代码仍在树里，但不是当前官方产品入口。
- README 的克隆链接和仓库链接使用 `https://github.com/Little-Red-Cre-Org/RedSparkHarness`。
- 2026-11-15 说明写明 Desktop 兼容装配和受支持的浏览器启动已经不在。
- 这次不删除或重命名任何包、快照、测试或工作流文件。

## Risks

以后的改动可能读到「退役」就删除 `native-web`、Web client、`prepare:dsh` 或 `@redspark/rsh-native-web-assets`。那些行是保留行。退役只适用于前置条件已经成立的独立用户入口。

快照迁移可能在这批文档合并前开始，并把 Native client 尚未覆盖的场景改到别的 profile。Desktop-only 说明拥有这些缺口。本清单不重新打开它们。

SDK、ACP 或 TUI 可能因为用户入口不是官方产品就被删除，而 `@redspark/rsh` 仍依赖它们的包，Desktop Host 仍依赖 `@redspark/rsh`。该加载尚未核实。只按产品句子去删，就是本说明要防止的失败。

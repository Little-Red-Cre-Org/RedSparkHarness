# Agent Note: CLI 只启动 Native profile，并退役动态 Cordis 界面

Status: implemented

[English](2026-11-19-cli-native-only-boot-and-legacy-retirement.md) | 中文

## Problem

`dsh` 启动器曾在同一个包里保留两条启动路径：经 `profile-boot.ts`、`compatibility-runtime.ts`、`plugin.ts` 与 `dump-config.ts` 加载的 Cordis 组合，以及经 `native-profile-loader.ts` 加载的 Native 组合。每个随附 profile 名称都同时拥有 Cordis 模板与 Native 模板，`profileRuntime` 在两者之间选择，CLI 还把 `@redspark/cordis` 与 Cordis Loader 插件声明为运行时依赖。这种分裂把 Cordis 留在 CLI 实际交付的应用里，也使 Cordis 删除同时变成启动器、profile 模板、打包测试与录制会话的改动。

动态 Cordis 工具界面加重了这个问题。`tool-cordis`、`cordis-host-runner`、`cordis-client-runner`、`ui-cordis` 与 `code-runtime-worker-thread` 的用途是检查、挂载并运行针对当前进程活跃 Cordis 运行时的代码。它们无法在该运行时删除后继续存在，并且占用七个模型可见工具与一个只为演练它们而存在的 Web 场景。

## Decision

`bin.ts` 只加载 Native runner。`readNativeProfile` 是唯一的启动门禁：profile 目录必须声明 `dsh.profile.runtime: "native"` 与 `rsh.profile.json` 组合；未选择 Native 执行的 manifest 会被拒绝，并指向迁移参考。`--dump-config` 使用同一门禁。

随附名称保留原身份，但初始化为 Native 组合：`headless` 对应 `native-headless`，`web` 对应 `native-web`，`sdk` 对应 `native-sdk`，`acp` 对应 `native-acp`，`rsh` 对应 `native-tui`。`--from-default-profile` 把任意随附 Native 模板复制为新自定义名称。`native-*` 模板仍是显式替代项。

`dsh plugin` 与 `--dump-default-config` 已删除。profile 包通过包管理器安装进 profile 目录，版本化的 `rsh.profile.json` 记录 installation 行；`--patch` 仍是按序应用的版本化 JSON overlay。

动态 Cordis 界面直接退役而非移植：

- `rsh/Modules/Official/extensions/tool-cordis` 及其七个模型可见工具被删除。
- `rsh/Modules/Official/extensions/cordis-host-runner` 与 `cordis-client-runner` 被删除；它们把插件挂载进活跃 Cordis 运行时。
- `rsh/Modules/Official/extensions/ui-cordis` 连同 Web 工具卡片与 slot 投影被删除。
- `rsh/Modules/Official/code-runtime/code-runtime-worker-thread` 被删除；TypeScript worker 执行归 `native-code-runtime`。
- Web Cordis 工具场景、其快照与 scaffold 选项被删除。
- Python 运行时冒烟只回放 Native 场景；退役 `sdk-minimal` 的拒绝检查改用 `--dump-config`。

`webworker-runtime` 与 `webworker-packer` 保留。Cordis-on-WebWorker 组合没有 Native 等价物：浏览器 WebWorker 无法承载 Native Host 运行时，且浏览器预览是私有实验而非 Harness 应用启动器。`code-runtime-python` 同样保留，因为它是 Python 代码执行的唯一提供方。

## Consequences

`rg '@redspark/cordis' rsh/Programs/CLI/src` 为空，CLI 运行时不再到达 `rsh/Compatibility/DSH/boot/app-boot`。Cordis 兼容 bundle 及其 Desktop/Web 消费方仍留在树中，等待后续删除，因此 `@redspark/cordis` 与 `cordis-plugin-loader` 仍保留在 CLI manifest 中供 packed compat-bridge 测试使用。启动器行为已是 Native-only，但包在后续改动落地前仍会交付 Cordis 载荷。

旧 CLI 创建的 profile 不会被重写。它们无法通过 Native 门禁，必须迁移为文档中的 JSON 形式；没有回退启动、自动转换或降级路径。

`verify-runtime-closure --target native-cli` 与 `verify-cordis-config` 报告的是既有失败：可选 peer 声明以及 `schedule`／`bundle-rsh` patch。这些失败在改动前的 `main` 树上同样可复现，并非本次退役引入；后续 Cordis 删除负责处理它们。

## Alternatives considered

**把 Cordis 启动路径保留在开关后。** 这能保留旧 profile，但 `@redspark/cordis` 与 Loader 插件会继续留在 CLI 运行时闭包中，两条启动路径都需要测试与录制会话，Cordis 删除最终仍要移除它们。该开关用一个永久存在的第二启动器换取一个版本的兼容性。

**把 `tool-cordis` 移植到 Native。** 该工具集的存在意义是检查并变更活跃 Cordis 组合。Native 等价物会是具有不同对象模型的新能力，而不是移植；一旦 Cordis profile 无法启动，检查／挂载／卸载界面就没有消费方。

**把 `cordis-host-runner` 保留为 Native 沙箱。** 它的 `node:vm` realm 是对诚实代码的隔离，不是安全边界，挂载代码可以触及宿主 realm。`native-code-runtime` 已提供产品所需的、带预算与取消的隔离 TypeScript worker 执行。

**连同其余部分一起退役 WebWorker 运行时。** 浏览器预览在 WebWorker 内运行 Cordis，没有可连接的 Native Host。删除它会移除一个可用的实验界面而不提供替代能力。

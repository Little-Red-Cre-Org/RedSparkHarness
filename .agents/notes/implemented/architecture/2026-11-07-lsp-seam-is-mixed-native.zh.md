# Agent Note: LSP 接缝属于 mixed native

Status: implemented

[English](2026-11-07-lsp-seam-is-mixed-native.md) | 中文

## Problem

`@redspark/rsh-lsp`、`@redspark/rsh-lsp-stdio` 与 `@redspark/rsh-tool-lsp` 都在 Cordis 插件之外提供了 Native 入口，但 `rsh/Scripts/native-package-policy.ts` 没有对它们中的任何一个分类。`check:ci:package-publication` 报出了两个后果：兼容性规则要求这些把 Cordis 声明为可选的包保留必需 peer，而 native 源码走查无法归属它们的入口源码。走查本身也经由入口抵达了 `@redspark/cordis`：stdio 内核与 `apply` 同处 `index.ts`，工具的上限与加载期校验位于 Cordis 插件内，而 `registry.ts` 从 `@redspark/rsh-llm` 取 `HarnessError`。

## Decision

三个包被登记进 `mixedNativeEntryDirectories`，各自写明共享实现的理由：`lsp` 是扩展路由与冲突检查，`lsp-stdio` 是可执行文件解析、隔离与拆解，`tool-lsp` 是参数校验、上限与结果渲染。

该分类只有在 Native 入口的完整导入闭包都不经过 Cordis 时才成立，因此每个共享实现都挪到了无 Cordis 的模块之后。`lsp-stdio` 把 `apply` 留在 `src/index.ts`，将 config schema、可执行文件解析、提供方构造与拆解移到 `src/providers.ts`。`tool-lsp` 把上限、超时预算、提示文本与加载期校验移到 `src/config.ts`，`src/index.ts` 保留工具注册与系统提示词区段。`render.ts` 改从 `@redspark/rsh-native-tools/presentation` 导入 `GenericCallView`，因为 `@redspark/rsh-tools` 带有 Cordis peer。`registry.ts` 改从 `@redspark/rsh-errors` 取 `HarnessError`，`@redspark/rsh-llm` 只是再导出它。

两个入口调用同一批挪动后的函数，因此该接缝对每个操作只有一份实现，而不是每个运行时一份。

## Alternatives considered

**为这三个包各写一套 Native 重实现。** 已否决。那样 Native 入口就需要自己的扩展路由、进程池与结果上限，两个运行时会在判定查询结果的行为上逐渐分叉。

**把包标为 compatibility-only 并让 Native 入口保持未分类。** 已否决。这些入口随每个启用了代码导航的 Native 配置一起发布，走查会持续在它们上面失败，包也会失去那条说明哪些 peer 可以可选的发布规则。

**对这一接缝压制两条门禁消息。** 已否决。两条消息报告的都是 manifest 与源码之间真实的不一致：peer 规则读 `peerDependenciesMeta`，走查读实际导入。压制它们等于把 Cordis 的导入留在 Native 闭包里。

## Consequences

三个 Native 入口无需 Cordis peer 即可抵达其实现，并由 `verify-native-dependencies` 走查该闭包来证明。审视面就是那张分类表：往 `lsp-stdio/src/providers.ts` 或 `tool-lsp/src/config.ts` 新增一个导入，就可能把 Cordis 放回 Native 链路，而该门禁正是拦下它的地方。

`@redspark/rsh-lsp` 与 `@redspark/rsh-lsp-stdio` 不再声明 `@redspark/rsh-llm`，两个包都没有导入它。`@redspark/rsh-tool-lsp` 保留它，因为其 Native 测试从 `@redspark/rsh-llm/native` 导入 `ToolCallId`。

Cordis 插件保持不变：本次改动对它们做分类，并不删除它们。此处不改变该接缝的行为、坐标处理或错误码。

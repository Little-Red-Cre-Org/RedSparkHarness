# Agent Note: packed-install 演练打包仓库中的 Cordis

Status: implemented

[English](2026-11-22-packed-install-packs-vendored-cordis.md) | 中文

## Problem

`rsh/Modules/Official/sandbox/sandbox-local/tests/packed-install.e2e.ts` 把 `@redspark/rsh-sandbox-local` 的发布 tarball 装进外部 npm 消费方。`consumer.mjs` 与 `rsh/Modules/Official/sandbox/sandbox-local/src/index.ts` 都从 `@redspark/cordis` 导入 `Context`。

`rsh/Modules/Official/sandbox/sandbox-local/tests/packed-workspace-closure.ts` 里的 `packedWorkspaceClosure` 跟随 `workspace:` 的 `dependencies`、`optionalDependencies` 和必需的对等依赖（peer dependency），并跳过可选对等依赖。`@redspark/cordis` 是 `@redspark/rsh-sandbox-local`、`@redspark/rsh-sandbox`、`@redspark/rsh-session`、`@redspark/rsh-llm` 和 `@redspark/rsh-attachment` 的可选对等依赖，因此从 `@redspark/rsh-sandbox-local` 出发的遍历不会把它打进 tarball。`@redspark/rsh-sandbox` 把 `@redspark/rsh-session` 声明为必需对等依赖。打包结果里没有能满足该 Cordis 对等依赖的 tarball。

这次演练不能把该省略当成安装成功。`consumer.mjs` 会导入 `@redspark/cordis`。仍去解析缺失可选对等依赖的安装器以 `ERESOLVE` 退出：失败节点没有 `version`，报告写成 `@redspark/cordis@undefined`。跳过该缺失对等依赖的安装器则会留下同一个未解析的导入。

## Decision

只有这次演练追加仓库内的 `@redspark/cordis`。`packed-install.e2e.ts` 在 `packedWorkspaceClosure` 之后读取工作区清单；闭包里没有 `@redspark/cordis` 时，它追加目录为 `rsh/Core/vendor/cordis` 的那个包。清单里没有该目录时，演练抛错。该包版本是 `4.0.2`，`files` 包含 `lib/index.js`。

`packedWorkspaceClosure` 仍然跳过可选对等依赖。`rsh/Programs/Web/client/web/tests/built-native-consumer.e2e.ts` 里的 Native packed 消费方走这条遍历，并要求 `node_modules/@redspark/cordis` 不存在。[原生浏览器入口无需 Cordis 即可安装](../process/2026-09-23-native-browser-export-dependency-closure.zh.md) 记录这份证据。

Cordis 唯一的 workspace 依赖是 `@redspark/cosmokit`，`@redspark/schemastery` 已经用必需依赖把它带入闭包。这次演练不打包 Cordis 的可选对等依赖 `@redspark/cordis-plugin-include` 和 `@redspark/cordis-plugin-loader`。它仍从这份清单里滤掉 `@redspark/node-addon-system*`，并通过 `pack-release.mjs` 打包 Landlock 入口。

## Alternatives considered

**让 `packedWorkspaceClosure` 跟随可选对等依赖。** 不予采纳。Native packed 消费方依赖这次跳过。跟随每一条可选 Cordis 对等依赖会把 `@redspark/cordis` 装进必须在没有 Cordis 的情况下安装的消费方。

**改用会忽略缺失可选对等依赖的 npm，或传入 `--legacy-peer-deps` 或 `--force`。** 不予采纳。这些选择避开安装仓库内的 tarball。`consumer.mjs` 仍然导入 `@redspark/cordis`。

**给 `dsh-packed-consumer` 补上 `version`，使安装报告不打印 `@undefined`。** 不予采纳。消费方清单没有 `version`，这行打印不是缺失的 tarball。补版本不会装上 Cordis。

**连同 Cordis 一起打包 `@redspark/cordis-plugin-include` 和 `@redspark/cordis-plugin-loader`。** 不予采纳。它们是 Cordis 的可选对等依赖，消费方不导入它们，`@standard-schema/spec` 仍走注册表依赖。

## Consequences

sandbox-local 的 packed-install 演练用仓库内的 `4.0.2` tarball 满足 Cordis 导入。那个 Native packed 消费方仍然省略 Cordis，因为 `packedWorkspaceClosure` 仍然跳过可选对等依赖。演练不把 `packable` 扩到 `rsh/Core/vendor/cordis/lib/index.js`。该文件已经在仓库内的包里，且 `files` 包含 `lib/index.js`。现有 packed-install e2e 就是这只 tarball 的回归检查。除非宿主是 Linux x64 或 arm64，并且 `rsh/Modules/Official/sandbox/sandbox-local/lib/index.js`、Landlock 入口和宿主的 `landlock-run` 二进制都存在，否则该检查跳过。

# Agent Note: Native 入口的面归属与派生的包文件清单

Status: implemented

[English](2026-11-04-native-entry-face-and-package-files.md) | 中文

## 问题

两处独立的缺口让 `./native` 成了特例，而不是一等入口。

[workspace 约束门禁](../../../../rsh/Scripts/check-workspace-constraints.ts)从八个入口子路径推导每个包的 `files` 数组，其中没有 `./native`，因此凡发布 native 产物的包都要手写一条 `packageFileExtras`。153 条含 `lib/native.js`，其中 22 条除此之外没有别的条目。

[Typert 分析器](../../../../rsh/Core/typert/generator/src/analyzer.ts)把 `./client`、`./client/*`、`./remote` 排除在 Host 面之外，其余导出全部收集，整个文件里没有读过 `dsh.native.targets`。于是「有真实 Host 程序、native 入口却只属 Client」的包——`rsh-client-file-upload` 拥有 `src/http-route.ts` 和 Host 服务——其 `./native` 被 Host pass 解析，而该文件根本不在 Host 工程里，解析因此失败。

## 决策

当清单 `./native` 的 default 目标恰为 `./lib/native.js` 时，`expectedRshPackageFiles` 推导出 `lib/native.js`，与 `./client`、`./worker`、`./runtime`、`./startup` 一样按产物路径判断。指向 `lib/types` 树的 `./native` 已由 `usesEmittedTreeDefaults` 覆盖，新规则不会重复计入。冗余的 `packageFileExtras` 条目已删除：剥离 131 处 `lib/native.js` 标记，删除 22 条整行条目。

仅当 `dsh.native.targets` 已声明且不含 `host` 时，`hostExportSubpaths` 才排除 `./native`。没有 `dsh.native` 的包不是装配行：它的 `./native` 仍是普通源码导出，Host 代码可以 import，因此该子路径保留在 Host pass 中。

## 考虑过的替代方案

**按子路径名而非产物路径推导。** 每个包都导出 `./native`，但其中 17 个指向 `./lib/index.js`、3 个指向 tsc 产物树、1 个指向 `./lib/native-boot.js`。为它们发布 `lib/native.js` 只会加入一个构建从不产出的文件，因此规则与既有 `./client` 行一样依据解析后的目标。

**保留 Host pass 中的 `./native`，改删 file-upload 的 `tsconfig.host.json`。** `src/http-route.ts` 是由 `index.ts` 引用的真实 Host 编译单元；为绕开子路径规则而删掉该工程会丢掉真正的 Host 产物。

**只要 targets 不含 `host` 就排除 `./native`，把未声明的 `dsh.native` 当作纯 Client。** 这读起来更严格、更防御，而且对当前工作区产出的产物逐字节一致。但它会悄悄丢掉所有未声明 native 行的库的 `./native`：`rsh-session`、`rsh-llm`、`rsh-subprocess`、`rsh-http-routes` 等 21 个包并非装配行，其 `./native` 是 Host 代码可以合法 import 的真实源码导出。目前没有代码 import 它，而这恰恰是不能依赖「当前导入者」的理由——它会把这个破坏隐藏到有人写下那行 import 的时候。

## 后果

native 产物与其它派生入口同等发布，新的 native 包不再需要 `packageFileExtras` 条目。门禁现在也能抓到漏写 `lib/native.js` 的 `files`。

Host Typert pass 不再分析清单显式限定为 `client` 的 native 入口。未声明的 native 入口仍可被分析，因此库可以保留一个可供 Host import 的 `./native`，而不必采纳装配行的清单。

## 验证

`check-workspace-constraints.spec.ts` 固定了产物路径规则、tsc 产物树排除、无该子路径的情形，以及带样式表的包。`native-targets.spec.ts` 针对一个 native 入口声明了服务的混合包，固定了 `dsh.native.targets` 的三种形态。

file-upload 复现（其清单加上 `tsconfig.client.json` 中的最小 `src/native.ts`）在改动前报 `typert(host): ... export ./native resolves to missing source src/native.ts`，改动后正常生成。

# Agent Note: Native Web Client 安装行及其发布的 native 入口

Status: implemented

[English](2026-11-03-native-web-client-installation-rows.md) | 中文

## Problem

`native-web` profile 通过 `NATIVE_WEB_CLIENT_INSTALLATIONS` 中的安装行选择浏览器 Client 包。安装行经 [native-client.ts](../../../../rsh/Programs/Web/host/native-web-assets/src/native-client.ts) 的 `createRequire(manifestPath).resolve('<plugin>/native')` 取到包代码，因此一行可加载需要三个互相独立的事实同时成立：包的构建产出 `exports["./native"].default` 所指的文件，该包的 `files` 列表发布这个文件，Desktop 打包取用的是打包后的 tarball 而不是工作区目录树。

一行可以在每个构建前门禁下全部通过，同时上述三个事实中有一个不成立。`verify-native-client-entries` 读源码与清单；Client 入口能通过它，因为 `src/native.ts` 存在且导出 `plugin`。构建预设决定 `lib/native.js` 是否被产出，`files` 决定 npm 是否保留它。Desktop 打包从 `.tgz` 组装，"在我的检出里能加载"并不推出"打包后的应用能加载"。任一步失败的包通过全部静态门禁，然后在打包进行数分钟后于 `prepare-dsh` 内以 `MODULE_NOT_FOUND` 失败，报错指向安装行而非构建。

## Decision

四个 Client 包带 `native-web` 安装行：`ui-brand-official`、`ui-input-trigger`、`ui-jobs`、`ui-message-feedback`。每个包的 `./native` 子路径是由 [tsdown.client.ts](../../../../rsh/Programs/Web/client/tsdown.client.ts) 的 `staticLinkedLeaf` 构建的静态链接叶子，并在其 `package.json` 的 `files` 中列出。

三个事实分属三个所有者。`tsdown.config.ts` 决定构建产出什么，清单的 `exports` 映射决定子路径解析到哪个文件，清单的 `files` 数组决定 tarball 携带什么。仅用 `clientBundle` 只构建 node 半与浏览器 bundle，因此只添加 `./native` 而不加 `staticLinkedLeaf` 的包，声明了一个它自己的构建从不写入的文件。

`check-workspace-constraints` 从清单推导期望的 `files` 数组，识别 `./client`、`./invariant`、`./worker`、`./store`、`./startup`、`./runtime`、`./loader` 与 `./typert` 子路径。它不从 `./native` 推导条目，因此发布 native 叶子的包改在 `packageFileExtras` 表中记录 `lib/native.js`。为让门禁通过而删掉该条目会把产物从 tarball 中移出。

`verify-native-build-output` 检查 Web profile 的两个随附组合：来自 `shippedNativeProfileComposition(home, 'web', platform)` 的 Host 行，以及来自 `shippedNativeProfileClientComposition('web')` 的浏览器 Client 行。对每一行，它断言 `exports["./native"].default` 在磁盘上存在且包的 `files` 列表覆盖它。它在所检查的构建之后运行，在 [run-gates.ts](../../../../rsh/Scripts/run-gates.ts) 中标记为 `needs: ['build']`。

`ui-jobs` 与 `ui-open-in-app` 发布它们产出的样式表，因为各自的 native 叶子按相对路径导入它；一个导入了样式表的 native 叶子需要 `files` 里的 `lib/**/*.css`，理由与需要 `lib/native.js` 相同。两者的 `packageFileExtras` 行同时携带这两个条目。

这些包中只有 `ui-jobs` 被分类进 `mixedNativeEntryDirectories`。该分类携带混合包规则所要求的可选 Cordis peer，且仅当 native 入口的源码闭包从不触及该包的 Cordis 半边时成立。其余三个保留必需的 Cordis peer：它们的 native 入口会触到导入 `@redspark/cordis` 或兄弟包 `./client` 子路径的文件，把它们分类为混合包会让 `verify-native-dependencies` 失败。

`ui-open-in-app` 不带 `native-web` 安装行。它的 native 叶子从 `@redspark/rsh-host-open-in-app/shared` 读取三个路由常量，而该包不声明 `dsh.native` 条目、也不出现在任何随附组合中，因此 Native 装配不提供任何 `/open-in-app/*` 路由来应答这些读取。这些路由常量经由 Native 装配排除的 `rsh-web-app` 到达 Client。要让交接说明里的这一行具备可用的启动路径，需要为这三个路由提供 Native Host 半边；该半边存在后此安装行回归。

## Alternatives considered

**把这类缺陷交给 `verify-native-client-entries`：** 拒绝，因为它读源平面。`src/native.ts` 导出 `plugin` 不说明 tsdown 是否产出 `lib/native.js`，也不说明 npm 是否发布它，而两个已观测缺陷都在这两处。

**只检查工作区目录树：** 拒绝，因为 Desktop 打包读的是打包后的 tarball。逐包执行 `npm pack --dry-run --json` 是唯一能看到打包器所见载荷的检查；对 `lib/native.js` 做 `Test-Path` 会对一个 `files` 已裁掉该文件的包报成功。

**在 `expectedRshPackageFiles()` 内部推导 `./native`：** 本次拒绝，因为该推导随后也会作用于所有把 `./native` 与包入口一起产出的 Host 包，改变它们的期望数组。把这些包记入 `packageFileExtras`，使改动只落在真正发布独立构建 native 叶子的包上。

**给 `dir` 单独的产物目录：** 拒绝，因为 `--dir` 与 `--unsigned` 在 [package-target.ts](../../../../rsh/Programs/Desktop/scripts/package-target.ts) 中是互相独立的两个轴。`dir` 现在带 `--unsigned` 运行，electron-builder 因此写入 `unsigned-artifacts`；共用目录是这个事实的结果，[package-desktop-win.ps1](../../../../rsh/Scripts/package-desktop-win.ps1) 据此校验。

## Consequences

只有当构建、`exports` 映射与 `files` 列表三者一致时，Client 包才能带 `native-web` 安装行；`verify-native-build-output` 现在对三者中任一违反都以行 id 报告，而不是留给打包晚期失败。其失败输出带组合类型，使缺失的 Client 产物与缺失的 Host 产物可区分。

该门禁读构建后的 `lib/` 输出，因此是构建后行。没有自己构建的运行没有 Client 产物可检查，会跳过该行，与它对 Host 行的既有行为一致。

向随附组合添加 Client 行现在会改变一个被检查的集合：该行必须解析到一个构建产出其 `./native`、且 `files` 发布它的包，否则门禁在打包开始前变红。

# Agent Note: Native 闭包跳过兼容专属 peer

Status: implemented

[English](2026-10-20-native-closure-skips-compatibility-peers.md) | 中文

## 问题

Native Desktop 包集必须带上 Cordis 内核，Native 行才能托管一个 Cordis 插件，同时又必须排除旧装配包。被选中的包可以 peer 这些被排除的包。跟随这条 peer 会把被排除的包选进闭包，Native 装配守卫因此失败。在插件清单里把该 peer 标成 optional 会掩盖 Cordis 模式的真实要求，而且下一条 peer 还得再标一次。

## 决策

`@deepseek-ai/cordis` 是 Native 运行时包。`CORDIS_RUNTIME_PACKAGES` 点名它，`@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-cordis-bridge` 依赖它。它不属于 `DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES`。loader、bundle 与 boot 包仍留在该名单里。

`selectClosure` 不跟随进入该名单的 peer 或 optional 边。进入该名单的硬 `dependencies` 边在选择时抛出 `requires compatibility-only package`。兼容装配传入空跳过集，仍跟随每一条边。Desktop 安装保持 `autoInstallPeers: false`，因此未满足的兼容专属 peer 不会从 registry 拉取。

`@deepseek-ai/dsh-persona` 仍把 `@deepseek-ai/cordis` 声明为非可选 peer。Native persona 行运行时由桥接包依赖 Cordis；这条 peer 仍然声明 Cordis 插件本身的要求。

## 考虑过的替代方案

**把每条触发守卫的 peer 标成 optional：** 这是为了满足 Desktop walker 而改变 Cordis 模式的安装语义。下一条非可选 peer，例如 `dsh-system-prompt` peer `dsh-invariants`，会再次撞上同一守卫。

**把兼容专属包移出排除名单：** 这会把 Cordis invariant 伴随包打进默认 Native 装配。排除名单就是为了阻止这件事。

**只删掉最先到达该 peer 的桥接依赖：** `dsh-persona` 仍然 peer `dsh-system-prompt`，而那个包 peer `dsh-invariants`。删掉一条依赖关不住这次遍历。

## 后果

Native 包集可以包含一个声明了兼容专属 peer 的包，而不选中那个兼容专属包。对这类包的硬依赖会在复制 tarball 之前失败。兼容打包在被包含的包声明了这些 peer 时仍然带上它们。本记录扩展 [原生 Desktop 私有 Host](2026-10-05-native-desktop-private-host.zh.md) 的决策，不取代 Host 拆分。

# Agent Note: 显式原生 Desktop 私有 Host

Status: implemented

[English](2026-10-05-native-desktop-private-host.md) | 中文

## 问题

每个 Desktop 发行包都必须让 Host 与它支持的 profile runtime 配对。原生 Client 的 Session RPC、follow 与 image 路由要求原生 Session controller，而 Cordis profile 需要独立的兼容 Host。若默认运行时携带旧的 Cordis 装配包，就无法维持只托管 Cordis 内核的 Native 装配。

## 决策

发行描述符选择 Native 装配或显式兼容装配，包集合要求对应的私有 Host 与 Desktop 发行版本一致。Native 是默认装配，打包 `@deepseek-ai/dsh-desktop-host` 且不含兼容专属可选依赖。Cordis 内核不在这些依赖之中；进入剩余名单的 peer 边会被拒绝，见 [Native 闭包跳过兼容专属 peer](2026-10-20-native-closure-skips-compatibility-peers.zh.md)。混合包同时发布 Native 入口时，会将仅供 Cordis 使用的 peers 声明为可选；Native 闭包仍保留该入口需要的共享包，兼容根包仍提供旧入口 peers。兼容打包使用独立的 `@deepseek-ai/dsh-desktop-host-compatibility` 身份和单独目标目录，并携带可用的旧版 profile 包闭包。Native 包管理器元数据会忽略精确的兼容专属可选包名，防止 registry 解析补回这些包，同时保留平台原生可选依赖。

新的 Desktop profile 选择 `dsh.profile.runtime: "native"` 和 `dsh.profile.config: "rsh.profile.json"`。升级只会把完全未修改的旧 starter profile 转为 Native；自定义 Cordis profile 保持不变，只有显式选择 `runtime: "legacy"` 且运行时包含兼容装配时才会启动。重置会创建 Native profile。

Native Host 复用 CLI profile 校验、preset 展开与安装规划，在同一作用域计划内提供 Electron 既有 Connection 传输，并仅激活一次所选 Session controller 与 Provider。所选 Client 替换根页面。包及导出的真实路径均必须位于已安装 profile 或运行时内。只有 Desktop 以显式允许链接包方式启动的工作区开发项目跳过此包含检查，并从工作区构建其 Client。规划加载器唯一允许的计算导入是已经从经校验安装清单解析出的导出入口。

## 考虑过的替代方案

**在兼容 Host 旁启动原生 Web 服务器：**增加监听器和另一个应用所有者，也可能重复执行 Agent。Electron 已持有私有分帧 Fetch 管道。

**在每个发行包中保留兼容 Host：**这会让 Cordis 成为默认 Native 运行时依赖，并导致 pnpm 恢复兼容可选依赖闭包。

**使用同一个 Host 包身份发布依赖装配而变化的内容：**两个不同负载会声称同一个带版本 npm 身份，发行描述符无法把 Host 包绑定到所选运行时。

**自动转换所有未标记的旧 profile：**这可能替换用户编写的 Cordis 设置。Desktop 只转换完全未修改的 starter；自定义 profile 保留在磁盘上，直到用户选择受支持的 runtime 或重置 Desktop。

**将 CLI 解析器复制到 Desktop：**独立解析器的清单校验与 patch 行为会发生偏差。仅提供规划能力的库导出复用解析器，不新增应用启动器。

**允许已安装 Desktop 使用源码工作区链接：**这使签名运行时执行安装目录之外的代码。共享资源构建器使用显式的仅安装模式。

## 后果

原生模式要求仅启动时配置、所选 Session controller 及其 Provider，以及原生 Client 配置。Cordis patch，以及声明了竞争传输或 application Provider 的活动 profile 或已展开 preset 安装项，都会在解析安装计划前被拒绝；禁用项不参与检查。Electron 在发布准备期间保留已有显式原生配置，并在停止 Host 前拒绝兼容插件变更。自定义 Cordis profile 需要显式兼容发行；重置选择 Native。Desktop 录制 Session 使用实际私有 Host 进程、已安装包、Client 资源及冷恢复；GUI 渲染与尚未支持的兼容菜单仍需独立验收。此变更不修改 Session 格式或 SDK 转录。

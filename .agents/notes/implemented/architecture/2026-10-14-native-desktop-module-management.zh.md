# Agent Note：Native Desktop 模块管理

Status: implemented

[English](2026-10-14-native-desktop-module-management.md) | 中文

## 问题

Native Desktop profile 会为带 scope 的 Host 组合和 Client 启动选择包。这些安装项需要包与启用状态管理，不能复用 Cordis 插件语义，也不能允许第二个写入方修改 Electron 独占的 profile。

## 决策

`DesktopProjectManager` 继续作为预留 profile 与包状态的唯一写入方。`dshDesktop.plugins.native` 通过 shell 自有的插件窗口、现有经过认证的插件 IPC channel、现有包事务锁、内置 pnpm、pending marker、共享包链接和 Host 重启钩子执行。渲染进程提交精确包版本以及明确的 Host 或 Client 安装项；inventory 读取不会返回文件系统路径、包管理器参数或原始配置。

Inventory 返回不透明的安装 id、已保存的 Host scope、包归属与能力、`hasConfig`，以及 profile 输入内容的 revision。每个变更都携带该 revision。manager 在停止 Host 前、持有现有锁时比较 revision；锁被占用时返回 `busy`，revision 过期时返回当前 revision，不修改 profile 文件。

切换状态时保留 Host 行的 scope 和 Client 行的配置。Client formatVersion 1 接受可选的 `disabled`；禁用行继续保存，但会从生成的 modules 和启动选择中排除。`disableAll` 保留 Desktop Host 必需项和已验证的最近必需 Provider 闭包；签名运行时包可以被选择，但不能被实际更新或删除。

Host 组合预检会在全新 worker 中导入选定的 Host 入口和 CLI 有条件补入的 child 支持行，因此包更新不会复用上一版本加载的 ESM 模块。worker 使用 CLI profile loader 的每个根作用域 launch-environment 与 `pluginInventory` Provider、SDK 或 ACP child-runtime launcher、启用 child module 缺少 Provider 时补入的子作用域 subprocess 或 sandbox 支持行，以及 Desktop 私有 carrier；它不会激活 Provider。Inventory 展开 preset 元数据并根据静态 Provider 关系计算保留项，不为当前启用的 child 安装项派生路由。启用/禁用候选与变更后的组合仍通过 CLI loader 派生并校验路由，因此配置错误的可选 child 仍可显示并关闭，而保留的错误配置会在 Host 停止前阻止变更。Preset 派生 scope、安装项和配置参与依赖检查，但不会写回已保存的安装行。`disableAll` 保留 Desktop 启动的必需 Provider 闭包；若该闭包保留了 preset manager 或派生 preset 安装项，也会保留该 manager 当前激活的派生安装项及其必需 Provider。否则，可选 preset manager 和其 Provider 可以一起禁用。Client 预检读取选定 manifest 并生成浏览器目标 bundle，不会在 Electron 主进程导入 Client 入口。选定的 optional 依赖参与排序和循环检查；required 依赖决定 `disableAll` 保留项。

包变更直接修改当前 profile。停止 Host 前，manager 保存 `rsh.profile.json` 与 `rsh.client.json` 的原始字节，包操作还保存 `package.json` 与 `pnpm-lock.yaml`。Host 交接后任何失败都会写回这些字节；包操作会用自有目录清理函数删除 `node_modules`（不校验失败依赖图中的宿主链接），再通过 pending marker 重新安装恢复后的锁定依赖，然后重启之前的 Host。恢复成功的变更以原错误码拒绝；只有恢复或重启失败才报告 `recovery-required`。pending marker 仍只表示包准备尚未完成。应用退出和更新安装会先停止或关闭 Host，从而取消正在等待的替代 Host 或恢复后旧 Host 的启动；进行中的变更随后恢复文件和包状态但不再重启 Host，并在应用退出前结算。退出或更新开始后到达的变更会被拒绝。`applied` 仅表示 Host 已就绪且 Client bundle 已生成。由于浏览器健康结果不会返回给 manager，浏览器激活与挂载错误仍由 GUI 验收。Native 启动重试在其条件有明确后端归属前保持隐藏。

## 考虑过的替代方案

**添加第二套包管理器或状态存储：**这会在 Desktop 锁、直接依赖、lockfile 和恢复 marker 之外再产生一个写入方。

**把 Client 禁用状态迁移到新的 profile format 版本：**可选布尔值能保留已有 formatVersion 1 行，并让缺省 `disabled` 继续表示启用。

**暂存 profile 副本或保持直接写入而不恢复：**暂存副本会在 pending marker 之外再增加一种恢复状态，而把失败组合留在原处会违背“之前的组合仍可启动”的要求。在内存中保存变更涉及的少数文件字节，再复用现有的锁定重装，即可恢复之前的组合，且不新增磁盘状态。

## 结果

Native 模块窗口可以管理包版本及 Host 或 Client 安装项，同时继续将旧 Cordis 插件操作分开。错误返回稳定 code、本地化 message key、真实后端 phase 和恢复状态，不包含配置值、文件系统路径或包管理器输出。组合校验拒绝（`profile-invalid` 或 `dependency-conflict`）仅在失败携带结构化校验 issue 时附带诊断；诊断只包含配置字段路径（provider、header 等由用户命名的条目以数字序号表示）和校验规则，不包含配置值、用户提供的键或原始错误文本。Client 启动默认项变更仍由 [Native Client 预览决策](2026-09-24-desktop-native-client-preview.zh.md)负责，兼容插件的失败行为遵循 [Desktop profile 决策](2026-09-09-desktop-in-place-profile.zh.md)。

定向 manager 测试覆盖通过 CLI `pluginInventory` Provider 保留必需项、child 路由可启用与缺少 model Provider 时在停止 Host 前拒绝、保存的 child 配置、preset 派生依赖保留且不写回生成行、过期和忙碌请求、精确包变更、部分包恢复、其他注入的 Host Provider、仅浏览器可用的 Client 入口、optional 依赖循环和更新后的 Host 入口。IPC 测试覆盖打包版管理窗口入口。Client bundle 测试覆盖禁用行的保留和从启用选择中排除。浏览器激活仍需打包版 GUI 验收。

生命周期用例还断言：过期、忙碌、保留行和 fresh-worker 预检拒绝都不停止 Host，两份 profile 文件字节不变；profile 写入和包 pending marker 都等待被挂起的 Host 停止完成；Host 停止失败时不写入任何文件，也不启动替代 Host，并在后端仍处于 `starting` 时报告 `recovery-required`；`applied` 等待替代 Host 启动完成；启动失败会写回原始 profile 字节、重启之前的 Host，并以 `host-start-failed` 拒绝；两份 profile 文件只写入一份后失败时，两份文件都会恢复且之前的 Host 会重启；恢复成功但之前的 Host 重启失败时返回 `recovery-required`，且原始字节已恢复；包操作失败会恢复 `package.json` 与 `pnpm-lock.yaml`，包括失败安装在保留的宿主包路径留下真实目录的情况；恢复安装失败返回 `recovery-required`。退出和更新用例断言：永不就绪的 Host 仍会被停止，进行中的变更会结算，退出会放行，之后的变更以 `busy` 拒绝。移除的证据覆盖已保存配置和生成的 Client bundle，不覆盖已挂载贡献的撤销。

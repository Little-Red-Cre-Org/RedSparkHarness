# Agent Note: Native profile runtime and legacy settings

Status: implemented

[English](2026-10-17-native-profile-runtime-and-legacy-settings.md) | 中文

## 问题

已有 profile manifest 缺少 runtime 标记时，即使没有声明 Cordis 组合包，也可能被误判为 legacy profile。Native settings 会保留未注册的分节，因此旧值可能继续留在文件中，却不再影响原行为，也无法进入 native 安装项。

## 决定

`dsh.profile.runtime` 显式选择 `native` 或 `legacy`。已存在但未标记的 manifest 只有在声明 `bundles` 数组时才属于 legacy；manifest 缺失时仍由原有初始化器处理，runtime reader 不写入 profile 数据。Native 模板与 legacy app-boot 初始化器各自保存对应的 runtime 标记。

CLI Native 启动器检查 profile 中实际安装的插件，以及由启用的 Native Web Host `config.projectDir` 选择的 Client 安装项。它从应用 JSON patch 后的有效 profile 读取 settings 文件路径和值，再锁定并重读原始持久 JSON 文件后应用迁移意图。当 native 目标未设置或仍为 shipped 模板值时，复制支持的值；目标等于旧值时跳过，其他值作为冲突拒绝。写入前会依据 native preset 发现结果验证 `agent-presets.default` id。它保留 `settings.yaml`；启动变量仅从继承的进程层检查，而 `.env` 继续拒绝 `DSH_*` 启动变量。预检与 Cordis patch 拒绝只在 CLI Native 启动路径运行，不进入 DesktopHost 共用的 profile reader。

CLI Native 启动器在激活插件前，根据启动环境安装现有 HTTP 代理 dispatcher，并在 Host 关闭后释放它。

## 考虑过的替代方案

**所有缺少 runtime 标记的 manifest 都推断为 legacy。** 拒绝，因为不完整的 manifest 会在既未声明组合包、也未声明 native 组合时静默进入 Cordis runtime。

**把进程变量映射到 profile 配置。** 拒绝，因为临时进程覆盖会变成持久 profile 状态。启动器改为拒绝不支持的进程值，并显式迁移 settings 文件值。

**从共用 profile reader 运行迁移。** 拒绝，因为 DesktopHost 也使用该 reader，而迁移与 Native CLI 环境检查只属于 CLI 启动。

## 后果

已有 Native CLI profile 可以在启动时把支持的旧 settings 写入 profile 文件，同时保留来源文档。发生冲突时，启动会在写入任一 profile 文件前停止。其他启动器保留现有 runtime 与配置行为。

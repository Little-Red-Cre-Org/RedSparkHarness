# Agent Note：Native patch 可插入安装项，模板可创建自定义 profile

Status: implemented

[English](2026-11-19-native-patches-insert-and-templates-create.md) | 中文

## 问题

Native `--patch` 只能替换 profile 已声明安装项的 `config` 与 `disabled`。部署若需要多加一个插件，只能手写 `rsh.profile.json`；Python SDK smoke 的补丁也无法表达自己的 MCP client 或 code-runtime 行。

`--from-default-profile` 会从组合包模板创建 Cordis profile。随附标准名称开始启动 Native 之后，这个 flag 成了创建自定义 profile 的唯一文档化路径，却产出一棵 Native runtime 无法启动的树。自定义 Native profile 因此没有受支持的创建路径。

## 决定

携带 `plugin` 与 `scope` 的 Native patch 行会追加一个新安装项。id 不能被 profile 或同一个 patch 占用，scope 必须已声明，plugin 必须是包名。不含 `plugin` 的行保留原有替换行为；只声明 `scope` 而不含 `plugin` 的行会被拒绝，而不是被忽略。合成结果会经 `parseNativeProfileConfig` 重新校验，因此插入无法绕过 scope、循环、重复 id 或包名检查。

`--from-default-profile native-<name>` 会把一个显式 Native 模板复制到新的自定义 profile 目录。它写入 `rsh.profile.json`、`runtime: "native"` 标记，并在 `native-web` 时写入 `rsh.client.json`；不写入 Cordis 组合包列表、`cordis.patch.yml` 或 pnpm workspace。目标必须是非随附名称，其目录必须不存在或为空。创建在 runtime resolver 之前执行，因此 `--dump-config` 会打印新组合而不启动它。

标准模板名称（`web`、`headless`、`sdk`、`acp`、`rsh`）在本次改动中仍创建 legacy profile。它们的 Native 替代已经就绪，但 Python SDK smoke 与 `dsh-pack-vfs-image` 仍会创建 legacy profile 并 patch Cordis 行；现在切换名称会在 Native 移植落地之前打断这些使用方。CLI 收尾会与这些移植一起切换。

## 考虑过的替代方案

**立即把所有模板名称映射到 Native。** 否决。`rsh/Scripts/smoke-python-runtime.py` 与 WebWorker 预览打包器会创建 `legacy-sdk`/`legacy-web` profile 并 patch Cordis 行 id；它们需要先完成各自的 Native 移植。

**新增独立的 `--from-native-template` flag。** 否决。它会复制创建规则，并在 legacy 启动退役时多留一个待删除的 flag。

**由调用方直接改写 `rsh.profile.json`。** 否决。这会复制校验逻辑，并让 Python SDK 的有序 `--patch` 接口没有 Native 形式。

## 后果

Native 部署可以通过一条有序 patch 行添加插件，而不必编辑 profile。`createNativeProfileFromTemplate` 是 CLI 收尾为所有模板名称使用的创建路径。`dsh plugin` 仍只管理 Cordis 组合包列表，标准模板名称在收尾落地之前仍创建 legacy profile。

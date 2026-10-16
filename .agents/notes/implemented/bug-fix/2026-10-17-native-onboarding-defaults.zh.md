# Agent Note: Native 首次引导默认值与起始目录

Status: implemented

[English](2026-10-17-native-onboarding-defaults.md) | 中文

## Problem

native-web 首次运行的模型步骤默认选中 Host 列出的第一个服务商（`amazon-bedrock`），而新会话使用的是 DeepSeek 路由。API 密钥输入框提示可以留空、使用环境认证，但这一步要求填写密钥，留空时“保存并继续”一直禁用。“稍后配置”不会被记住，每次刷新都会再次出现。工作区目录选择器从 Host 的主目录打开，而不是 Host 启动时所在的目录。

## Decision

- `rsh/Programs/Web/client/native-application/src/onboarding.tsx` 中的 `readModelSetup` 在没有可用服务商时才读取 `modelCatalog()`（因此较慢的目录刷新不会拖慢已配置好的启动），并把 `catalog.default.provider` 指定的服务商移到列表最前，因此 `ModelOnboardingView` 默认打开 Host 的默认会话路由。
- `ui-primitives` 中的 `ProviderEditor` 在设置了 `credentialRequired` 时一律显示 `keyPlaceholder`（“输入 API 密钥”）。可选填写的设置页编辑器仍保留 `keyStored` 和 pi-ai 的 `keyPlaceholderNative` 文案。
- “稍后配置”会向 `localStorage` 写入 `dsh.native.onboarding.models` = `2026-10-17.1`。该值与欢迎确认同时存在时，`NativeOnboarding` 直接从 `done` 开始。之后仍可在“设置 > 模型”中配置服务商。如果 `localStorage` 拒绝写入，只在当前页面跳过这一步。
- 不带路径的 `directories/list` 会列出 Host 进程的工作目录（`process.cwd()`，即启动所在目录），并且每次列目录都附带 `home`。侧边栏用 `listing.home` 缩写路径并作为目录选择器的主目录面包屑，因此起始目录不会顶替主目录。

## Alternatives considered

**允许在引导中保存空密钥。** 未采用：如果某个服务商的环境认证已经可用，Host 会把它报告为可用并跳过这一步，因此保存空值只会写入一条不可用的路由。

**给 `ModelOnboardingView` 传入初始服务商属性。** 未采用：在 native 组合层排序列表能得到同样的结果，还会让默认路由成为第一个选项，而且不需要改动共享视图的属性。

## Consequences

首次运行会落在 DeepSeek 上，密钥输入框的提示不再与禁用的保存按钮矛盾，跳过的配置在版本串变化之前保持跳过。native-web 的目录选择器现在从 Host 启动目录开始；旧版 Cordis 的目录选择器仍沿用其 Host 的行为。

## Testing

`native-application/tests/onboarding.client.spec.tsx` 覆盖默认路由被首选、必填密钥的占位文案，以及“稍后配置”在重新挂载后仍然生效。

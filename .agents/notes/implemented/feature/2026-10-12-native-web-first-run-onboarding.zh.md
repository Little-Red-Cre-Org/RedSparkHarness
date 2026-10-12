# Agent Note: Native Web first-run onboarding

Status: implemented

[English](2026-10-12-native-web-first-run-onboarding.md) | 中文

## Problem

native-web 组合会直接打开应用，而 legacy Web 客户端会显示版本化欢迎声明，并在没有可用模型时提示配置提供方。Native Client 不能导入 Cordis 功能插件来复用其引导流程。

## Decision

`ui-primitives` 持有无 Cordis 的 `OnboardingModal`、`WelcomeNoticeView` 和 `ModelOnboardingView`。Legacy 适配器提供现有 Settings、凭据与确认状态；native-application 在 `OnboardingSurface` 中组装共享内容，并提供由选定 `NativeSessionClient` 支持的回调。

Native 引导读取活动提供方目录、可配置提供方目录、Settings namespace 和引用凭据状态。只有 Host 报告没有可用的活动提供方且至少有一条可配置路由时，页面才显示共享提供方编辑器。提供方设置通过带 revision 检查的 `settingsMutate` 写入；API 密钥通过 `credentialsSet` 写入。订阅登录仍由 Models 设置页负责。

Native 欢迎确认版本保存在当前 origin 的 `localStorage` 中。应用根节点 inert 期间，引导页顶部仍提供原生语言和主题控件。

## Alternatives considered

**让 native-application 导入 legacy 引导插件。** 拒绝，因为 Cordis 服务和功能包运行时导入不属于 Native Client 模块图。

**添加 Host 所有的欢迎确认方法。** 首次引导采用浏览器本地持久化已足够，选定 Host 已提供提供方、Settings 和凭据事实，因此本次不增加该方法。跨浏览器确认属于独立的 profile-preferences 能力。

**在 native-application 复制提供方编辑器。** 拒绝，因为 `ui-primitives` 已经持有两个组合共同使用的 props-only 提供方表单（[Native Models 决策](../architecture/2026-10-11-native-models-settings-page.zh.md)）。

## Consequences

欢迎确认按页面 origin 隔离，不会与其他浏览器共享。关闭提供方设置只结束本次引导；重载后，流程会重新检查 Host，并在仍没有可用提供方时再次提示设置。授权和账户操作仍可从引导外的 Models 设置页访问。Host 数据和凭据规则仍由现有的 [Native Settings 决策](../architecture/2026-10-06-native-web-settings-credentials.zh.md)维护。

# Agent Note: 把一个内置 skill provider 移植到 Native

Status: implemented

[English](2026-11-07-native-skill-badge.md) | 中文

## Problem

把 Cordis web bundle 的行与随附的 Native 组合逐行 diff 后，`@redspark/rsh-skill-badge` 落在缺口里：Cordis bundle 组装了它，而没有任何 Native profile 组装。于是 Cordis 会话有 `dsh-badge` 技能而 Native 会话没有——这是一个没有可见故障的能力差异，因为目录里少一个技能只是列出的技能更少。

该包完全没有 Native 半边，所以这是移植，而不是组合修正。

## Decision

`src/native.ts` 注册同一个 provider 对象。这个 provider 除了注册表之外不需要任何宿主服务：它的候选与正文都从随包发布的文件读取，因此整行就是一次 `skills.registerProvider` 调用。

这种形状的移植必须处理两件事，二者都由门禁而非评审来保证：

- Native 源码不得导入 Cordis 包的根，因此共享词汇来自 `@redspark/rsh-skill/shared` 与 `@redspark/rsh-skill/types`——这是 `nativeSafeSourceSubpaths` 已为该包发布的子路径。导入根会把 Cordis 入口拉进 Native 图。
- `native-package-policy` 会先给每个包分类，`verify-native-dependencies` 才接受它的入口。两半边并存的包属于 `mixedNativeEntryDirectories`，并要用一句话写明两半共享什么；同时它的 Cordis peer 必须是 `optional`，因为仅 Native 的安装不得要求 Cordis 内核。

provider 注册需要传入 Native 注册表要求的 scope；Cordis 半边不传，因为它的 `Context` 自带。

## Alternatives considered

**用 `skills.register` 注册一个内存中的定义。** 否决：正文是随 `assets/` 发布的文件，内联它要么复制文件，要么丢掉 skill 用来解析自身资源的 `resourceBase`。

**让 badge 只留在 Cordis 侧并删掉这一行。** 否决：该技能是产品能力，不是 Cordis 机制。删行会让它从 Native 会话里永久消失，而不是被移植。

## Consequences

- Native 会话的技能目录里会出现 `dsh-badge`，描述与正文与 Cordis 会话读到的一致。
- `tsdown.config.ts` 与 `files` 现在发布 `lib/native.js`；没有构建配置时，包会公布一个加载器无法解析的入口。
- 覆盖：组合测试按 id 断言该行，因此移除它会让 Native profile 测试失败，而不是静默丢掉该技能。

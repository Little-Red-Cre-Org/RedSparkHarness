# Agent Note: Native 设置页复用浏览器表现层

Status: implemented

[English](2026-11-04-native-settings-pages-reuse-cordis-presentation.md) | 中文

## 问题

两个 Web 设置包——只读的插件清单页和模型页——把整套表现层做成按 props 驱动的组件加一个页面 store，但它们各自通过 Cordis 专属接口访问 Host。清单页读 `ctx.remote.pluginInventory`，它回答的是 Loader 组成：按预设分组的行，以及带根 Fiber 阶段的全局 Loader 条目。模型页读 `ctx.remote.llm`、`ctx.remote.credentials` 与 `ctx.remote.settings`，并取得 ui-settings 的 `SettingsSchemaService` 与共享 describe 镜像。

Native Host 没有这些。它没有 Loader，因此报告的是安装项而不是 Loader 条目；它也没有设置 slot，因此两个页面没有可注册的外壳。把任一页面改写成第二份 Native 实现，会让两个客户端必须保持一致的 provider 编辑器、清单目录与引导界面统统翻倍。

## 决策

两个包各增加一个 Native 入口，把**同一份**表现层绑定到 Native 传输。

**清单页做适配，不做重写。** `clientNativeSession.pluginInventoryList` 报告安装状态；`installationPhase` 把这个封闭状态联合映射到目录的根 Fiber 阶段词汇，`toSnapshot` 把行投影进全局平面。Native profile 安装的是它组成里列出的行，因此每个被报告的安装项都是启用的，只有 `disposed` 不是。该传输上没有 Agent 预设名册，因此 `agentPresets` 保持缺席，目录只渲染全局平面。

**模型页把依赖收窄成一个端口。** `ModelsSettingsStore`、`createModelsOperations` 与每个 provider 卡片原本接收 Cordis `Context`；现在改为接收 `ModelsRemoteHost`，即它们真正读取的 Remote 切片，wire 类型由本包自己的 `client/ports.ts` 拥有。`createNativeModelsFace` 从 `clientNativeSession` 回答同样的 carrier 信封，`createNativeDescribeFace` 是页面的文档读取面。Native 与浏览器的两处差异在适配器里折平：Native 传输以拒绝表示失败，而不是回答失败信封；它把命名空间标识拼作 `namespace`，而 wire 拼作 `ns`。

**schema 端口是被声明的先决条件。** 模型页需要 schema 读取与不可变草稿编辑，由 ui-settings 在自己的 Native 入口发布为 `clientNativeSettings.schema`。本包声明该服务名并把列在 `optional` 下，而不是导入服务类，因此这个包可以独立构建、独立评审。声明合并比较的是整份声明，因此这里的增补是一个具名引用类型（`NativeSettingsServiceReference`），与 provider 的形状对齐：两侧必须指出同一个类型，任一侧加宽或收窄都会破坏合并。缺设置领域基底的组成会在激活时以缺失 provider 大声失败。

## 备选方案

**给每个页面写第二份 Native 实现。** 这会复制 provider 编辑器、模型列表编辑器、引导对话框与清单目录，两份拷贝会在第一次改动文案时漂移。两个包的浏览器半边本来就是 props 驱动，只有传输是 Cordis 形状的。

**导入 ui-settings 的 Native 入口以复用其服务类。** 这会让一个包的构建依赖另一个包的入口，native 依赖图会拒绝；而且它对两个包的发布顺序产生无谓约束，相比声明端口没有任何收益。

**无条件注册进 `settings.plugins.tab`。** 直接对未声明的 slot 调用 `slots.register` 会抛错。两个入口都走 `slots.inject`：它等待声明、在声明塌陷时移除贡献，在没有 Native 设置外壳声明该席位时不安装任何东西。

## 后果

两个包都发布 `./native` 并被随附的 native Web profile 安装。清单页在任一 Native 设置外壳声明 `settings.plugins.tab` 后立即贡献。模型页从其 Native 入口发布已绑定传输的 store、operations 与 schema 端口；它会在某个 Native 设置外壳声明 `settings.section` 后渲染，而那个外壳自己的 Native 半边是剩下的先决条件——Native 应用当前的设置面板是就地构建页面，而不是通过设置 slot。

两处 `dsh.native` 清单对各自入口安装的东西保持如实：清单页 requires `clientSlots`、`clientLocale` 与 `clientNativeSession`；模型页 requires locale 注册表与 Session client，并把设置领域基底视为可选。
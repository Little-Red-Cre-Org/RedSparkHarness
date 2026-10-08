# Agent Note：依赖安全公告版本下限与图片签名闸门

Status: implemented

[English](2026-10-08-dependency-advisory-floors-and-image-signature-gate.md) | 中文

## 问题

`pnpm audit` 针对 lockfile 报告了 1 个 critical 级和 48 个 high 级安全公告。其中两项会直接影响交付行为。0.35.5 之前的 Sharp 版本带有在解析格式期间触发的 libvips 加载器安全公告，而附件准入在检查容器格式之前就把提交的字节交给 Sharp，因此 libvips 会在模块拒绝该格式之前先选择加载器，其中包括 HEIF/AVIF 与 SVG 加载器。Desktop 运行时还会交付其清单中固定的 pnpm 版本，而 pnpm 11.7.0 落在四个已由 11.11.0 修复的 pnpm 安全公告范围内。其余问题来自低于修复版本的直接依赖范围，以及父包仍锁定易受影响版本的传递依赖。

## 决策

直接依赖清单要求使用已修复的版本：`@modelcontextprotocol/sdk` ^1.32.1、`sharp` ^0.35.5、`compression` ^1.8.2、`undici` ^8.11.2，并在所有使用方（包括 vendored Include 清单）中使用 `js-yaml` ^4.3.2。根目录 `packageManager`、native-system 清单与 Desktop 的 `pnpm` 依赖固定使用 pnpm 11.28.5，该版本的发布时间早于 pnpm 默认的 1440 分钟 `minimumReleaseAge`。

`pnpm-workspace.yaml` 中的 overrides 只在单个发布线的易受影响范围内提升传递依赖，因此任何使用方都不会跨越主版本。undici 下限限定在锁定 6.x 与 7.x 发布线的父包（`node-gyp`、`@electron/get`、`@yao-pkg/pkg-fetch`、`e2b`、`jsdom`），MCP SDK 下限限定在作为 mcp-client 测试夹具的两个 MCP 参考服务器。

文档站点的 Vue 包作为一个整体移动。`vue` 与所有 `@vue/*` 编译器、运行时和服务端渲染器包都固定为 3.5.43，该版本包含 `@vue/server-renderer` 针对 GHSA-g2v6-rqmx-r4w6 的修复；`vue` 会把这些包固定为与自身完全相同的版本，因此单独提升其中一个会拆分运行时。当 VitePress 记录 `vitepress data not properly injected in app` 或与之对应的 `Cannot read properties of null (reading 'ce')` 渲染错误时，生产文档构建会失败；随后 `docs:build` 会运行 `verify-doc-site-render`，拒绝 `#app` 中没有任何元素的语言首页，以及任何没有 `.vp-doc` 文本的其他服务端渲染页面。

在 `@deepseek-ai/dsh-attachment-local` 中，每个 Sharp 流水线都通过 `openSupportedImage()` 打开，该函数只接受 PNG、JPEG、WebP（`RIFF`/`WEBP`）与 GIF87a/GIF89a 的起始签名。其他任何字节都会在 Sharp 接收之前以 `INVALID_IMAGE` 和既有的 `Unsupported or malformed image data.` 消息失败。准入、头部探测、规范化与请求变换共用这个函数。

## 考虑过的替代方案

**使用 `undici@>=6.0.0 <6.28.1` 这类版本范围 override：** 拒绝，因为 pnpm 会把选择器应用到每个与之相交的范围。该选择器把 openai 的 `>=5 <9` peer 范围改写为 `^6.28.1`，并把 workspace 的 undici 8 peer 退回到 6.x。

**使用 `'@vue/server-renderer@<3.5.42': '^3.5.42'` 单独提升 `@vue/server-renderer`：** 经 Zining（@Aceared0829）评审后拒绝。渲染器升到了 3.5.43，而 `vue` 仍停留在 3.5.39，因此 VitePress 服务端渲染加载了第二份 `@vue/runtime-core`，站点组件无法看到其中的渲染实例状态。包括英文与中文首页在内的每个页面都以空的 `#app`（`<!---->`）写出，而构建仍以 0 退出，片段检查也照常通过。

**只依赖解码后的格式检查：** 拒绝，因为 libvips 在读取元数据时就会选择并运行加载器，所以在 `metadata()` 之后才拒绝，易受影响的解析器已经处理过这些字节。

**只把 pnpm 提升到 11.11.0：** 拒绝，因为更新的 11.x 版本包含更多修复，且 11.28.5 已满足发布时长策略。

**升级文档站点的 vite、extract-zip 与 e2b：** 推迟。文档站点的 vite 5 来自 vitepress 1，需要 vitepress 2；extract-zip 没有已修复的版本；e2b 的修复需要主版本升级。

## 后果

完整审计从 1 个 critical、48 个 high、50 个 moderate、12 个 low 降至 0 个 critical、3 个 high、23 个 moderate、5 个 low；生产依赖审计没有 high 或 critical 问题。剩余的 high 问题来自文档站点的 vite 与 Desktop 的 extract-zip。每个 override 都必须在所有父包要求已修复版本后移除。

破坏服务端渲染的 Vue 版本，或再次与 `vue` 版本不一致的渲染器，现在会让 `docs:build` 以及 CI 运行的 `doc-sync` 文档构建失败，而不是发布空页面。提升 Vue 家族时需要同时修改全部十个固定版本。

签名不是 PNG、JPEG、WebP 或 GIF 的附件字节现在会在不进行任何解码工作的情况下被拒绝。带有受支持签名的字节仍会经过完整解码和既有格式检查。原先注入任意字节的规范化测试现在会在字节前加上受支持的签名，以继续覆盖编码器失败映射。

## 验证

`tests/signature.spec.ts` 用记录调用的包装函数替换 Sharp。有效的 PNG、JPEG、WebP 与 GIF 会到达 Sharp；SVG 文本、带 XML 前缀的 SVG、HEIF 与 AVIF `ftyp` box、TIFF、非 WebP 的 RIFF、截断签名、空输入与随机字节都会以 `INVALID_IMAGE` 失败，且 Sharp 没有记录任何调用。

在渲染器版本拆分的状态下，`pnpm run docs:build` 记录了 1,500 条 `vitepress data not properly injected in app` 与 188 条 `Cannot read properties of null (reading 'ce')` 错误，现在会以 1 退出；`verify-doc-site-render` 报告全部 190 个服务端渲染页面，其中包括 `index.html` 与 `en/index.html`，而片段检查仍然通过。使用对齐后的 3.5.43 家族时，构建不再记录这两种错误，两个首页都渲染出 VitePress 的内容容器，SPA 与 MPA 构建都通过两项检查。`rsh/Scripts/verify-doc-site-render.spec.ts` 覆盖正常与损坏的页面形态以及构建日志守卫。

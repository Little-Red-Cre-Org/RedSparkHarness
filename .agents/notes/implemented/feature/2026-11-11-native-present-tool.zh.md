# Agent Note：Native present 工具

Status: implemented

[English](2026-11-11-native-present-tool.md) | 中文

## 问题

`present` 工具让 Session 把完成的文件声明为交付物：模型在写出产物后调用它，交付被记录下来，宿主因而能提供该文件而不复制内容。它当时唯一的实现是 `@redspark/rsh-tool-present` 里的 Cordis 插件，通过 `ctx.tools.register` 注册并读取 `sessionProjections.stateOf(session, 'turnBoundary')`。

Native profile 不组合这样的行，也没有任何 Native 包实现它。在 `src` 中搜索 `present` 工具注册、在每个 native 测试 profile 中搜索该行，结果都是空的，因此 Native Session 完全无法声明交付物。这是实测清单上最后一个确实缺少 Native 形态的包。

## 决定

`@redspark/rsh-tool-present` 在其 Cordis 入口旁发布 `./native` 入口，并在 `native-package-policy.ts` 的三张表中登记为混合包。两半共享 `types.ts`，它通过对 Session 事件映射的声明合并来声明 `deliverables/presented` 事件——Native session 的 `known-event-types.ts` 已列出该类型，因此不需要新事件。

该贡献读取 Native 工具执行已提供的两个事实。`NativeToolExecution.turn` 给出开放回合，取代了对 `turnBoundary` 投影的读取。`NativeToolExecution.appendEvent` 记录交付：它先 append 到 Session 再持久化，因此事件加入调用方的 pending 批次，而不会把它拆开。

校验与 Cordis 主体一致：每个路径必须是已存在的常规文件，在记录任何内容之前通过 `fs.lstat` 与 `fs.stat` 检查。

## 已考虑的替代方案

**通过兼容桥接层复用 Cordis 插件。** 已排除：桥接层的作用是为已经运行 Cordis 的 profile 适配 Cordis。Native profile 没有 Loader 也没有 `ctx.tools`，桥接层没有可适配的对象。

**从 session 投影读取回合。** 已排除：`NativeToolExecution.turn` 是注册表为这一次调用已经解析好的开放回合，而读取投影会重新引入 Native 运行时已经去掉的顺序依赖。

**只在工具结果里记录交付。** 已排除：协议要求模型可见的即被记录。宿主会渲染的交付必须能从 Session 日志重建，而仅靠工具结果在回放后不会作为可查询事实留存。

## 后果

Native profile 现在可以组合 `present` 并记录持久交付。Cordis 那一半保留到 `base` 退役，因为 `base` 与 Python SDK 运行时仍 import 它。

该包需要包级 `tsdown.config.ts`。仓库级 tsdown 入口不包含 `native`，没有它时构建只产出 `lib/types/index.js`，且 `lint` 会因缺少该入口而失败——这是每个带 Native 入口的包都有的要求。

此前记录的「这次移植需要两个不存在的接缝」是错误的：`turn` 与 `appendEvent` 本就存在于执行对象上。成本在于正确读取贡献 API，而不在于新增运行时能力。

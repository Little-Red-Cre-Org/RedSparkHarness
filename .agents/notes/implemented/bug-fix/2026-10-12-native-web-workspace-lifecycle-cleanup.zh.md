# Agent Note: Native Web 工作区生命周期清理

Status: implemented

[English](2026-10-12-native-web-workspace-lifecycle-cleanup.md) | 中文

## 问题

Native Web 的工作区注册、动态 Program 路由、排队修改和 Client follow 迭代器拥有彼此独立的生命周期。删除注册可能留下空闲 Session owner 并占用路由容量；已取消的排队操作仍可能修改状态；而 consumer 停在已 yield 的帧上时，关闭 Client 可能永久等待。持久化的冷启动工作区 Session 也会在路由尚未选择时被误判为无法管理标题；一个不可用目录链接还会导致整个目录列表失败。

## 决策

排队的 Workspace 操作在进入队列前和实际开始时都检查调用方取消信号。删除操作会退休捕获在该 Workspace 路由上的每个活跃 root owner；撤销路由时也会先排空空闲且无主 Agent execution，再移除注册。忙碌路由会阻止删除移除注册。目录和持久化 Session 日志都会保留。

Workspace follow 使用配置的 `maxFollowers` 容量，达到上限时返回 HTTP 429。即使异步生成器停在 `yield` 上，Client follow 也会在取消时完成关闭等待；生成器完成时会移除 abort listener。

安装了标题服务且没有冲突的 delegated owner 时，即使持久化 Workspace Session 尚未选择动态路由，也允许管理标题。重命名和刷新处理器会通过 `routeForSession()` 选择路由。目录列表会忽略目标无法 `stat` 的符号链接，并保留可用的同级条目。

## 备选方案

- **先移除 Workspace 注册，再释放路由。** 否决：忙碌路由可能因此继续占用容量，却失去对应的注册 Workspace；路由退休失败时保留注册，便于后续重试。
- **Client 关闭时等待异步生成器的 `finally`。** 否决：consumer 停在已 yield 的帧上时，只有恢复或 return 迭代器后才能进入 `finally`。
- **一个链接无法 `stat` 就让整个目录列表失败。** 否决：不可用条目不应隐藏有效的同级条目。
- **等 Workspace 路由已存在后才启用标题操作。** 否决：处理器本身可以选择已注册 Workspace 的路由。
- **为 Workspace 删除增加独立的空闲 Agent 退休操作。** 否决：路由撤销已拥有完整的空闲 Session 集合，可以直接排空无主 execution，无需增加公共 API。

## 后果

Workspace 删除会在排队操作中回收空闲运行时 owner；路由撤销会排空空闲且无主的 Agent execution，活跃工作仍会阻止撤销，并保留注册以便稍后重试。Workspace 和 Session follow 流各自执行配置的 follower 上限。路由选定前即可提供冷启动标题操作；不可用符号链接会从列表中消失，但不会抑制其他条目。

# Agent Note: Native 会话查询与投影后端

Status: implemented

[English](2026-10-09-native-session-query-entry.md) | 中文

## 问题

Native 消费方需要在已连接的 Session owner 与持久化日志上使用同一个查询服务，也需要全文搜索与投影；同时不能创建第二个 Session writer 或另行实现一套折叠算法。

## 决策

`SessionQueryOperations` 是 Cordis 与 Native Provider 共用的 Cordis-free Definition。Native 来源适配器在捕获的事件切点读取活动 owner，并通过可选持久化 handle 读取脱离运行时的历史。活动 Session 校验已接纳的历史；冷日志则通过脱离运行时的 Session 回放校验。观察租约会固定已准备的冷修订；runtime 关闭时拒绝新读取、取消并等待已接纳的来源工作，然后释放 turn-boundary 注册。

Native SQLite Provider 在同一来源上组合精确查询和排序搜索。Cordis-free 核心管理派生 FTS 数据库、事务对账与世代绑定游标，但不会成为 Session 存储。即使 id、header 和事件相同，替换活动 owner 也会递增语料世代，使旧游标陈旧失败。仅精确查询的组合保留查询操作，并以 `SESSION_QUERY_SEARCH_DISABLED` 拒绝搜索。

Cordis 与 Native 投影 Provider 使用同一个折叠注册表。cell 以精确驻留 Session 对象为键，Native Provider 跟随活动 owner 的接入和移除。注册表保留按 stateVersion 共享注册、迟到注册时回放、继承切点、脱离的检查点值及同事件变更通知。Native 检查点写入只有在规范 Session writer 刷新后才使用选定缓存；缓存只是权威日志上的折叠捷径。关闭查询和投影 Provider 时，会排空其拥有的读取、监听器、计时器和写入。Native 投影激活的后续 observer 注册失败时会释放先前注册；关闭时会尝试移除全部 observer 与 owner 事件监听器、清空注册表状态，并在尝试完成后报告清理故障。

Native 投影脱离 owner 时会禁用事件传递，并在监听器移除失败时仍清除注册表所有权；残留回调不能驱动折叠。注册表清空后，旧注册的 disposer 不能移除同名的新注册。Native cache 每次挂载前都会核对当前精确 owner 是否仍在活动集合中，包括等待先前启动写入之后。缓存在调用事件监听器移除函数前会将 owner 状态标记为已脱离；即使移除失败，也会尝试最终检查点、移出 owner 状态，并报告移除错误。关闭时会尝试移除全部 observer 与 owner 监听器、排空最终写入、关闭存储域，再聚合清理故障。移除失败后仍注册的回调不能排入缓存工作。

Typert 的 shared-definition 公共类型索引会纳入同一包、同一 face 中启用 declaration 输出的项目引用所包含的源声明。只有类型解析到公开导出的必需 `Context` 成员才是 service 候选；若该导出解析为 class 或 interface 之外的声明，分析会拒绝它。

变更流和已接纳事件观察者若抛出异常，会逐个报告。注册表继续通知其余监听器并驱动剩余投影单元；已接纳事件观察者不会把成功持久化并刷新的追加变为 writer 故障。

已发布的 `native-headless-query` profile 显式选择 Native query、SQLite、projection 与 cache Provider。现有 profile 默认值保持不变。Engine 工具和归档消费者使用共享 query Definition；Host 与 SDK 适配器仍由各自模块负责。

## 考虑过的替代方案

**另建 Native query Definition 或折叠实现。** 分离的权威可能在过滤、观察切点与投影语义上分歧，因此 Cordis 与 Native 都适配同一个 Definition 和投影折叠。

**让查询持有 Session writer 或把索引写进规范持久化数据库。** 查询自有 writer 可能与 Session 追加竞争，FTS 事务也可能损坏或改写源日志。SQLite 数据库保持为只读来源端口之上的可丢弃派生索引。

**默认选择 Native query profile。** 现有组合已有稳定的 Provider 选择和依赖。Native headless query profile 保持显式选择，直到发布策略有意改变。

## 影响

Native 组合可以使用完整的提供方无关查询词汇，并在不导入 Cordis 的情况下选择 SQLite 排序搜索。搜索游标只对产生它的语料世代有效；没有兼容检查点缩短投影回放时，冷读仍需加载权威事件历史。Session 格式和 writer 所有权仍归 Session 包管理。

## 验证

定向观察者与 owner 代际回归通过：抛出异常的投影监听器不会阻断后续监听器或单元；抛出异常的 Native 已接纳事件观察者不会破坏驻留 writer；替换一个内容完全相同的活动 owner 会同时使 session-search 和 event-search 游标失效。

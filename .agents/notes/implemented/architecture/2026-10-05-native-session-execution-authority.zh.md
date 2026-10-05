# Agent Note: 原生 Session 执行权威

Status: implemented

[English](2026-10-05-native-session-execution-authority.md) | 中文

## 问题

原生 Program 需要共享子任务执行、人工维护和保留的 Session 工作，同时不能创建另一个 writer，也不能从历史 parent id 推导存活权威。

## 决策

NativeAgent 为每个精确注册身份持有 FIFO 执行及独占空闲维护。SessionExecution 定义并提供活动所有者路由、step 准入和委派。Headless 提供根操作及 continuation driver，使用其既有模型与工具调度。保留的 Session 只有一个 writer、一个持久 inbox 和一个 Program 持有的 activation；注册表观察不会激活冷 Session。

Preset 租约在贡献准备之前选择 Agent scope。选择从既有 header 和 canonical selection event 重建。移除先取消该租约，再等待已接纳工作，并于排空后释放 scope。Workspace 的原生和 Cordis 消费者共享既有 v2 域及全局归档 id 记录；目录选择创建不可变 Program 路由，不改变沙箱权限。

可恢复删除是可选持久化能力。JSONL 将包含全部保留代际的完整 Session 目录移入按回执寻址的保留命名空间。Program 检查精确路由和 revision，并拒绝忙碌所有者。恢复检查保留的 header 和目标，不覆盖已占用 Session。该能力不会擦除代际字节，也不修改仓库已提交的夹具。

## 影响

模型可见 inbox 认领及选定输入使用既有 Session 事件，在 dispatch 前持久记录。构造回调将 seed marker 交给同一个 writer。流观察者接收既有模型 dispatch；观察者失败会保留已记录的部分尝试。这些操作均不添加模型循环、权限权威或辅助 writer。

关闭先取消准入、排空已接纳操作，并尝试关闭每个 execution 和保留的 epoch。Agent 身份和 preset 资源释放之后聚合独立失败。锁获取与变更在释放同时失败时保留原始错误，并报告两个原因。原生与兼容持久化消费者使用同一删除操作，Client 声明入口只包含回执身份与操作类型。

本变更不选择默认 SDK、Web 或 Desktop 组合。其各传输消费者属于独立发布工作。只读历史工具拒绝缺失、损坏、未来格式及过量历史，不返回截断或替换的 Session。

全部 Agent 释放回调会在等待排空前启动。生命周期通知失败会回滚已取得的 preset lease，驻留子级 header 保留选定 preset 供冷恢复校验。活动 owner 观察者失败后，一次性 writer 仍必须关闭，原始与清理错误一同报告。

## 考虑过的替代方案

第二个 continuation 队列或 writer 会拆分有序输入所有权。从历史 lineage 重建存活 invocation 会在无关 Program 入口之间转移权威。归档元数据不能替代可恢复文件系统删除。

## 验证

定向拥有者用例使用真实 NativeHost、JSONL 持久化及既有受控模型 adapter。覆盖无模型请求的维护、跨父任务关闭与冷恢复的常驻子任务、另一 writer 仍被保留时的独立关闭失败，以及冷恢复前后保留代际的字节一致性。发布验证检查拥有者 TypeScript 程序及不依赖 Cordis 的原生入口；不声称所有应用载体已迁移。

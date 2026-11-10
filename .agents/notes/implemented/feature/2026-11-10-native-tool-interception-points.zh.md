# Agent Note: Native 工具拦截点

Status: implemented

[English](2026-11-10-native-tool-interception-points.md) | 中文

## 问题

Native 运行时没有逐调用的工具决策点。策略可以在调度前分类并发（`executionMode`）、包裹主体（`aroundExecution`）、变换已完成的结果（`postResult`）、观测结算（`onResult`、`onSettlement`），以及在批准前同步拒绝（`guard`）。但这些都不是兼容层的 `tools/pre-execute`：拒绝无法携带面向模型的理由并记录持久结果，批准只能由贡献自己静态声明，也没有任何点在主体完成之后、结果策略之前运行并拥有把成功调用变成本身记录下来的纠正性反馈的权力。

这个缺口阻塞了钩子桥接。Claude Code 的 `PreToolUse` 映射到 `tools/pre-execute`，`PostToolUse` 映射到 `tools/post-execute`；Native 侧的工具调用流水线是 `native-headless` 步骤循环里的内联序列，而 `native-tools` 的有序调度只负责调度主体。钩子所需的兼容词汇中两部分——前置的 allow/deny/ask 与后置的 pass/block 加上下文——没有 Native 对应物，因此不写第二条分叉的决策路径就写不出桥接。

[兼容层拦截笔记](2026-06-30-interception-extension-points.zh.md) 当初选择把参数改写排除在前置工具策略之外：历史、审计与 UI 都读取执行前已记录的那份参数。Native 沿用这条规则。已记录的 `tool/call` 参数永不改变；前置决策只能替换主体收到的已解析参数，Native 应用在主体运行前仍按同一 schema 校验它。

## 决策

`@redspark/rsh-native-tools` 在作用域注册表上拥有两个有序拦截点，与它已有的执行策略和结果策略并列。

`interceptBeforeCall(interceptor, scope?)` 在主体运行前为一个调用作答：`allow`（可带替换参数）、带理由的 `deny`，或带可选理由的 `ask`。`interceptAfterCall(interceptor, scope?)` 为一个已完成的主体结果作答：`pass`，或带纠正性反馈的 `block`；两种答案都可以附带带来源的用户消息。

两者都是注册表其余部分意义上的 waterfall：监听器要么用 `next()` 委托，要么自行作答，第一个作答的监听器结束整条链。被委托的分支会被等待至静止，而监听器自己的答案保持权威——这正是 `postResult` 已使用的语义，因为钩子可能把下游失败（超时、拒绝）翻译成自己的答案。

这两个点运行在注册表的准备与结果流水线内部，也就是每个由注册表服务的调用都会经过的位置：

1. 在准备阶段校验参数并抵达 guard 之前，前置点作答。`deny` 与被拒绝的 `ask` 会变成携带该决策理由的 `HarnessError` 抛出，因此应用记录的错误结果与 guard 拒绝形状相同，主体从不运行。`ask` 通过调用既有的批准权威解决，封闭结果会给出模型读到的理由：人拒绝了、问题被撤回，或不存在可询问的通道。
2. 替换参数值会被快照为无损 JSON 并冻结，然后成为该调用在校验、guard、批准作用域键与主体中使用的参数。拦截器给出非无损值会显式失败。
3. 主体结算后，后置点在结果策略之前作答。`block` 用 `isError` 结果替换结果，内容为反馈；并且——与 `tools/post-execute` 一致——丢弃主体自身延迟的上下文，只暴露阻断决策提供的那些。`pass` 保留主体结果，并把决策上下文追加在结果自身上下文之后。

Native 应用也会为自己的内建工具（`read_file`、`write_file`、`run_code`）询问同样这两个点，因为它们没有可接到拦截点的注册表注册。因此一条策略按工具名声明一次规则，而不是按传输通道各声明一次；只安装注册表侧拦截点的钩子仍然管控模型发出的每个调用。

`NativeToolExecution` 新增可选 `turn`，让决策能指明它为哪个打开的回合作答；不在已记录回合内的调用省略它，而不是编造 `0`。

## 影响

把外部钩子协议映射到这两个点的桥接会记录 `hook/*` 事件、收到类型化的决策词汇，无需第二条流水线。前置点不能改写已记录的调用，这使日志、审计者与 UI 对「实际运行了什么」保持一致；需要有效参数的读取方从注册表封存的调用中读取。

拦截权威保持分离：前置点可以拒绝、询问或改写参数；后置点可以接受或阻断并添加上下文；guard 仍是前置点之后单调、同步、只拒绝的不变量；结果策略仍然变换后置点所接受的结果。任何点都无法强制放行被后续不变量禁止的操作。

注册表把新点作为既有类的方法发布，因此 [native 包策略](../../../../rsh/Scripts/native-package-policy.ts) 不需要新增条目或子路径。`pnpm run typecheck`、`pnpm run lint:contracts-ready`、native-tools 单元套件、native-headless 单元套件与 native-headless 录制会话套件覆盖该行为。

## 备选方案

- **用 `aroundExecution` 兼做两个决策。** 否决：环绕策略只能在委托后替换结果，因此拒绝型钩子无法阻止主体运行，阻断型钩子也无法让模型读到反馈而非输出。而这两点正是该协议的意义。
- **把拦截点加在 `native-headless` 而不是 `native-tools`。** 否决：决策属于拥有校验、批准、guard 与结果处理的注册表，而分发嵌套 PTC 调用的程序也走同一注册表。安装一次的策略必须覆盖它们。
- **允许前置决策改写已记录的 `tool/call` 参数。** 按兼容层笔记的理由否决：历史与呈现早已按记录文本写出。
- **只对注册表服务的调用作答。** 否决：钩子协议的 matcher 针对的是工具*名*。把 `read_file`/`write_file`/`run_code` 排除在外，会让 `PreToolUse` matcher 对目录中三分之一的工具静默失效。

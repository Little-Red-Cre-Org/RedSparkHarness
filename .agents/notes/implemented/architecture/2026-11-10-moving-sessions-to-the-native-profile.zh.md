# Agent Note: 把录制会话迁到 Native profile

Status: implemented

[English](2026-11-10-moving-sessions-to-the-native-profile.md) | 中文

## Problem

把一个录制场景从 Cordis 的 `legacy-headless` profile 迁到 Native profile 不是改清单就行。场景用模块软链加行来拼 profile，而其中若干事实在任何包清单里都看不出来：哪些行本来就存在但被禁用、注册表会占住自己发布的工具名、子会话需要自己的回放 fixture、fs Provider 自己的字节预算决定录制结果长什么样。

这次迁移还必须在两个运行时真正不同之处做出决定——截断结果怎么报告、父模型能否看到子级推理、被取消的子级报告什么、子级身份记在哪里——以及在只有走到该路径的场景才会暴露的缺口，例如让应用待写批次脱同步的钩子记录，或丢失分类的模型失败。

没有记录，下一个人要把这些重新踩一遍；而一个只是组合不完整的场景，看起来就像产品缺陷。这种混淆在一次迁移里制造了三次假警报。

## Decision

逐个场景迁移，让每个场景携带它依赖的组合事实与运行时差异。可复用的结论记在这里，而不是写进逐个场景的进度笔记。

**场景必须携带的组合事实。** 一个子会话需要一个已提交的 fixture，按角色顺序通过 `RSH_SNAPSHOT_CHILD_FILES` 传入；按轮创建子级的工具每轮一个 fixture。profile 已声明的工具必须用 `composeRow` 启用而不是再插一行，因为重复 id 与重复 provider 都会被拒。装了 code-runtime 工具的 profile 必须同时装它的工具，否则内建 `run_code` 会占住这个名字并拒绝录制中的参数。依赖 shell 的场景要点名能跑它录制方言的 provider，连同该 provider 需要的 `subprocess` 与 `shellEnv`。观察截断或写入结果的场景要携带录制使用的同一组 fs Provider 预算。

**运行时差异要写明，不要掩盖。** 截断结果在两个运行时都保留诊断尾部与可恢复路径，但由不同层格式化。子级结果就是它的文本，父模型永远收不到子级的推理；未完成的子级把兼容层标题与保留的部分答案放在同一个块里。终止标记带宿主形状，所以场景同时接受 POSIX 信号名与 Windows 退出状态，但仍强制要求超时本身。子级把身份记在自己的日志而非父级，所以场景断言两者共有的事实。

**场景发现的缺口在拥有它的接缝处修。** 拦截与准入事实携带应用的受跟踪 appender，因为绕过唯一连续批次的追加会让下一次持久化脱同步；准入路径的 appender 只 track 不持久化，因为持久化会切断调用方仍在拼装的批次。回合边界从任何 `HarnessError` 读取已分类的失败码。被钩子拒绝的 prompt 与其 blocked 回合原因一起报告退出码 0，因为拒绝是决定而不是崩溃。发布 `./native` 的包需要自己的构建入口，因为根构建的默认入口列表不含它。

## Consequences

迁移后的场景证明了它断言的东西：它携带的组合就是录制运行时所用的组合，因此持久日志里的差异是真实差异，而不是少了一行。三次假警报——`ralph-loop`、`archify-auto-routing`、`both-mode-turn`——都是组合不完整，现在各自成了一条有记录的事实而不是重复调查。

六个本会无声上线的缺陷被修掉：已分类的失败码、钩子与准入记录走受跟踪 appender、准入 appender 不持久化、被拒绝 prompt 的退出码、缺失的 `hook-protocol` 构建入口，以及钩子桥接的模块形状。前两个在正常路径上不可见，只在出错时显现，而那正是持久日志必须解释的时刻。

五个备选方案记为已排除，不会被重试：Native 版 `rsh-agent-default-model`、用 `agent/created`/`agent/disposed` 当 SubagentStart/Stop、串行的 `session/starting`、返回布尔的 `turn/stopping`，以及在 step 准入钩子内部 enqueue 钩子上下文（会死锁，因为 enqueue 等待的正是调用它的那次准入）。

**只靠组合无法回放的场景。** 有四类需要一个决定而不是一次组合。依赖宿主沙箱行为的（`partial-landlock-*`、`missing-sandbox-runner`）声明 `platform: posix`，验证 Linux Landlock，只能在它们所描述的平台上录制。依赖活的 fixture 服务的（`web-fetch`、`web-search-endpoint-guidance`）需要一个 Cordis 插件和确定的 `web` Provider，而 Native 装配器没有对应接缝。依赖回合中途改变会话的驱动的（`system-prompt-in-history`、`model-switch-notice`）在步与步之间记录一次 prompt 或模型变更；纯回放只会产生一条 system message 和一次请求，变更根本不发生。比它所验证的 schema 更早的录制（`persistent-pwsh-tool-turn`，缺少两个 shell 工具都要求的 `description`）需要重新录制，而不是放宽参数。

## Alternatives considered

- **把逐场景指引写进每个快照目录。** 否决：组合事实在几十个场景里重复，逐场景笔记会变成与运行时逐渐脱节的噪音。
- **把每处差异都当兼容性缺陷、改运行时去对齐。** 否决：其中若干差异是刻意的——父模型不应读到子级的私有推理，而收集器的截断提示才真正知道边界。
- **把迁移结论留成 `.agents/notes` 之外的进度文档。** 否决：这个仓库把可长期保存的工程记录放在 notes 树里并配双语对；游离目录没有门禁、没有配对、也没有归档纪律。
- **断言兼容层的事件名让序列完全一致。** 否决：子级的 `subagent/descriptor` 在子级自己的日志里，为了满足快照而编造一个父级事件，等于记录运行时并不会做的事。
- **跳过需要专用驱动的场景。** 对不需要驱动的场景否决：组合事实正是迁移必须建立的东西，跳过场景等于让 profile 未被证明。

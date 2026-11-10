# Agent Note: 还有谁依赖 Cordis

Status: proposed

[English](2026-11-10-what-still-depends-on-cordis.md) | 中文

## Problem

这次迁移的目标以删除 Cordis 收尾。能否达到取决于还有多少包依赖它、以什么方式依赖——而这个数字不在任何一个文件里。读 profile 模板的人看到六个 bundle；读包策略的人看到分类；两者都不说还有多少代码非得靠 Cordis 运行时才能跑。

在迁移分支上实测：**268 个包把 \`@redspark/cordis\` 声明为 dependency 或 peerDependency**。其中 **\`rsh/Compatibility\` 与 \`rsh/Tests\` 之外的 113 个**没有 \`dsh.native\` 入口，也就是说它们根本无法在 Native 运行时下跑。

## Proposal

现在把实测形状记录下来，让删除 Cordis 按事实规划，而不是假定它会跟着场景迁移一起完成。

这 113 个按区域分：\`Programs/Web\` 35、\`Modules/Official\` 21、\`Modules/Community\` 9、\`Engine/core\` 8、\`Engine/session\` 6、\`Core/vendor\` 6、\`Engine/context\` 4、\`Engine/subagent\` 4、\`Core/typert\` 4、\`Engine/jobs\` 3，其余散落在 \`Programs/{SDK,Desktop,CLI,ACP}\`、\`Core/{util,subprocess,storage,runtime-diagnostics}\`、\`Engine/{preset,llm,compaction}\`，各为一两个。

最大的一块是 Web 应用面，Native 运行时目前还不承载它。第二块是官方 Modules，其中若干旁边已经有 Native Provider——Cordis 那一半正是组合了兼容 bundle 而不是 Native bundle 时场景仍会走到的部分。

## Acceptance criteria

- 删除的每一步 `verify-native-dependencies` 都通过。
- 每个被删的包，其剩余 importer 都在删除它的 PR 里点名。
- `Programs/Web` 要么迁移、要么明确记为不在范围内并写明理由。
- 收尾时 `rsh/Compatibility` 之外没有任何包 import `@redspark/cordis`。

## Risks

删除 Cordis 不是场景迁移的后续步骤，而是另一次更大的迁移，有自己的先后顺序。由实测得出三条影响规划的事实：

- **\`Core/vendor\` 必须最先或最后处理，不能卡在中间。** 那六个包就是钉住的 Cordis 源码本身；任何仍 import \`@redspark/cordis\` 的东西都传递依赖它们。
- **\`Core/subprocess\`、\`Core/storage\`、\`Core/util/launch-environment\` 是基础设施而非叶子。** 它们有 Native 兄弟包（\`subprocess-local\`、各 session 后端），但 Cordis 原件仍被依赖，所以删除顺序必须显式切断这些边，而不是靠删包解决。
- **Web 应用面是最大的一整块。** 它是客户端而不是引擎包，因此对「删运行时」而言可能合理地不在范围内——这必须是规划要明确写出的决定，而不能留成隐含。

这条笔记的存在是为了让下一轮先测量再删除。包计数不是计划，但没有计数的计划只是猜测。

## Alternatives considered

- **把场景迁移当成全部前置条件。** 被实测否决：场景走的是 profile，而有 113 个包只能通过迁移要移除的兼容 bundle 从 profile 到达。
- **先删 \`Core/vendor\`，因为它是最小最显眼的一块。** 否决：所有带 Cordis import 的东西都传递依赖那些源码，先删会在边被切断前把树打断。
- **把这次测量并进迁移那条 Agent Note。** 否决：那条记的是怎么迁移一个场景，这条记的是运行时到底能不能移除。它们回答不同的问题，会在不同的时候被读到。

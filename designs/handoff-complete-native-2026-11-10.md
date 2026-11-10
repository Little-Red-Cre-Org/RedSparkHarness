# 交接：补全 Native 运行时，删除 Cordis —— 进度（2026-11-10）

你是接手者。仓库 D:\RedSparkHarness（Windows）。执行中不要停下来提问，按本文自行推进；用户只做最终验收。

## 0. 一句话现状

工具拦截点与两个 hooks 桥接的 Native 形态已落地。86 个会话场景仍全部跑 Cordis，Cordis 还不能删。

## 1. 已完成（本轮）

| PR | 内容 | 状态 |
|---|---|---|
| #337 | `runHook` 的 shell 参数接受任一 shell 服务 | 已 merge `fec8cc0686` |
| #338 | Native 工具执行前后拦截点（`interceptBeforeCall` / `interceptAfterCall`），并在 `native-headless` 消费（含内建工具） | 已 merge `f653e50ff7` |
| #339 | `hooks-claude-code` / `hooks-codex` 的 `./native` 入口；Native 新增 `session/starting` 与 `turn/stopping` 生命周期事件 | open（含 CI 修复） |

### T-A 交付了什么

- `@redspark/rsh-native-tools` 新增 `interceptBeforeCall` / `interceptAfterCall` 两个有序 waterfall。
  - 前置：`allow`（可带替换参数）、`deny(reason)`、`ask(reason)`。`ask` 走调用既有的批准权威；`allow` 的替换参数经无损 JSON 快照与冻结后成为主体参数——**已记录的 `tool/call` 参数永不改写**。
  - 后置：`pass` 或 `block(feedback)`；两者都可附带带来源的用户消息。`block` 会丢弃主体自身延迟的上下文（与 `tools/post-execute` 一致）。
  - 后置点在结果策略**之前**运行，因此 `block` 才是结果策略与模型看到的输入。
- `native-headless` 对自建工具（`read_file`/`write_file`/`run_code`）也询问同样两个点，所以策略按工具名声明一次即可。
- `NativeToolExecution` 新增可选 `turn`。

### T-B 交付了什么

- 两个 hooks 包发布 `./native` 入口，共享配置解析、payload 词汇、matcher、runner、合并与持久 `hook/invoked`/`hook/result` 事件对；只有扩展点接线不同。
- `@redspark/rsh-hook-protocol/native` 导出无 Cordis 的那一半。
- 事件点映射：

| 事件 | Cordis 点 | Native 点 |
|---|---|---|
| SessionStart | `agent/session-start` | `session/starting`（并行）+ request-context provider |
| UserPromptSubmit | `agent/pre-step` | 活动 owner 的 `beforeStep` 准入钩子 |
| PreToolUse | `tools/pre-execute` | `tools.interceptBeforeCall` |
| PostToolUse | `tools/post-execute` | `tools.interceptAfterCall` |
| Stop | `agent/turn-stopping` + `steer()` | `turn/stopping` + `next-step` 收件箱准入 |
| SubagentStart/Stop | `subagent/start` / `end` | 无对应物（已记录为缺口） |

## 2. 量化现状（2026-11-10 晚，T-B 合并后）

`snapshots/session/` 86 个场景，全部 `profile: legacy-headless`。

**真的运行 hooks 的只有 14 个**（按录制里是否含 `hook/invoked` 统计）：

`hook-cc-posttool-block`、`hook-cc-posttool-context`、`hook-cc-pretool-ask`、`hook-cc-pretool-deny`、`hook-cc-promptsubmit-block`、`hook-cc-promptsubmit-context`、`hook-cc-stop-continue`、`hook-codex-posttool-block`、`hook-codex-posttool-context`、`hook-codex-pretool-block`、`hook-codex-promptsubmit-block`、`hook-codex-promptsubmit-context`、`hook-codex-stop-continue`、`packed-chunks`。

**已迁到 Native 的 16 个**（`snapshots/native-headless/*-native.snapshot.ts`，套件 37/37 通过）：
`text-turn`、`todo-write`、`repeat-tool-reminder`、`session-sandbox-root`、`fs-policy-reject`、`fs-read-window`、`fs-write`、`fs-write-overwrite`、`fs-delete-recreate`、`tool-call-turn`、`workspace-edit`、`hook-cc-invalid-matcher`、`hook-codex-invalid-matcher`、`hook-cc-pretool-deny`、`pi-ai-replay-metadata`、`fs-read`。

剩余 default、无 hook 的场景：`bash-startup-timeout`、`bash-tool-turn`、`error-finish`、`ralph-loop`、`skill-load`、`subagent-*`（4 个）、`workflow-run`、`archify-auto-routing`。

**迁移一个场景实际要装的行**（踩过才知道）：模块软链名不带 `@redspark` 前缀；要用 bash 工具需同时装 `rsh-bash-local`（提供 shell）、`rsh-subprocess-local`（提供 subprocess）、`rsh-shell-env`（tool-bash 需要）；Native 的 `write`/`edit` 每次变更都会询问批准（文档化契约），所以要么给 granted answerer，要么用 `never` 策略；`maxSteps` 必须够跑完全部工具调用加最后一条消息。

### 已解决：ralph-loop（第 8 轮）

之前的「第 2 轮子级拿不到结构化汇报」不是能力缺口，是**组合写法错误**：照搬 workflow-run 时 `childFixtures` 只写了一个子 fixture，而 ralph 每轮创建**一个新子会话**，所以第 2 轮绑到越界脚本、拿到空 entries、以 `assistant/attempt` 收尾。补上第二个 child fixture 后两轮都通过。

ralph 的完整组合：`rsh-workflow` + `rsh-workflow-worker-thread`（`config.subagentProvider` 必填）+ `rsh-tool-workflow`（`config.provider`）+ `rsh-tool-ralph`（`config.workflowProvider` + `config.subagentProvider` 都必填）+ `subagents` 行；`childFixtures` 按轮次给全。

### 已知阻塞：skill-load

录制的调用是 `{"name":"editing-cordis-compositions"}`，来自一个本仓库已不再发布的 preset。workspace 里只有 `snapshot-skill`、`model-only-skill`、`user-only-skill`。迁移后跑出来的结果是 "skill ... is unknown or no longer available"。**不要**把断言改成接受这个结果——那样会把能力缺口伪装成通过。要么恢复该 preset，要么接受这个场景在 Cordis 删除后作废（需要单独决策）。

### PTC 组合要点（第 11 轮实测）

`both` 模式的场景（`both-mode-turn`）要装：`rsh-native-code-runtime`（base profile 里已有该行、但默认 disabled，用 composeRow 改 `disabled: false`）+ `rsh-tool-code-runtime` + `rsh-code-runtime-worker-thread`。

**关键坑**：只装 runtime 不装 `tool-code-runtime` 时，registry 里没有 `run_code`，于是 `native-headless` 的**内建** `run_code` 抢占了这个名字。内建的参数名是 `program`，而录制里模型传的是 `code`（schema 由 tool-code-runtime 定义），于是结果是 `unexpected run_code argument code`。看到这条错误就该想到是内建占位工具在应答，不是产品缺陷。

迁移后的断言要落在 `tool/ptc-dispatch` 上——嵌套调用有自己的一条持久事件（含 `subCallId`、name、arguments、content），这才是「可被日志重建」的证据，而不是只看外层 tool/result 的文本。

### 待解决：UserPromptSubmit 的 context 附加（第 17 轮发现）

`hook-cc-promptsubmit-context` 暴露了一个**真实的语义缺口**，不是组合问题：

Cordis 层把 prompt-submit hook 返回的 context 作为**一条独立消息**追加（source 是 `{kind:'plugin', plugin:'hooks-claude-code'}`），它不在 admission 的候选集合里。而 Native 桥接目前写成 `messages: [...downstream.messages, ours]`，把这条消息**塞进 admission 选中的输入**，于是 `native-step-admission` 的校验拒了它：

```
native-step-admission: decision must select unique captured input ids
```

这条校验是对的（admission 只能从捕获的输入里挑选），错的是桥接的返回方式。

**试过但不成立的修法**：在 admission 钩子内部 `await owner.enqueue(ours, 'next-step', true, signal)` —— 会**死锁**（admission 在等 enqueue，而 enqueue 又要等 admission 结束），表现为 30 秒后被杀。

**下一个人的方向**：钩子不要在 admission 同步返回里做 IO，而要把 context 交给「step 打开之后」的路径——对照本文件里 Stop hook 的既有写法（`owner.enqueue(..., 'next-step', true, signal)` 在 `turn/stopping` 监听器内，那里没有 admission 在等待），或者让 admission 决策增加一个「待追加消息」字段由 Program 在提交后写入。

## 3. 下一步（按顺序）

### T-C 迁 default 组合里不跑 hook 的 26 个场景

可以直接抢进度：`rsh-sandbox-policy` → `native-sandbox-policy`、`rsh-user-approval` → `native-approval`，然后批量迁移。

### T-D 迁其余 46 个

按 composition 分批，每批一个 PR。

### T-E 清 Cordis-only 包

必须排在 T-C/T-D 之后。

### T-F 删除 Cordis

前置：场景全迁完、`PROFILE_TEMPLATES` 的 6 个 Cordis bundle 模板退役、Cordis-only 包全部处理完。

## 4. 已判定的死路（不要重走）

- **`rsh-agent-default-model` 的 Native 形态**：Native 侧没有消费方（场景默认模型直接写 profile 行），PR #335 已关闭。
- **用 `agent/created`/`agent/disposed` 模拟 SubagentStart/Stop**：它们广播每个 Agent（含根），没有父级归属，会为主会话触发 SubagentStop。
- **让 `session/starting` 串行**：一个永不退出的钩子会拖慢每个会话的首个请求。
- **让 `turn/stopping` 返回布尔**：准入必须在回合决策前持久，返回值会让两者矛盾。

## 5. 环境坑（踩过的，别再踩）

| 坑 | 表现 | 对策 |
|---|---|---|
| 改完 src 没重建 lib | 端到端用旧 lib，误判「插件没生效」 | `tsc -b <pkg>/tsconfig.json --force` 再 `cd <pkg> && pnpm exec tsdown` |
| PATH 首位是 WSL bash | 快照报错 | `$env:PATH = 'C:\Program Files\Git\bin;' + $env:PATH` |
| hooks 测试在 Windows 被排除 | `vitest` 报 No test files found | 用一次性 `vitest.<name>.config.ts` 显式 `include` 临时跑；跑完删掉 |
| `native-tools` / `native-agent` 有 host/client 双 face | `TS6306: must have setting "composite": true` | tsconfig references 指向 `<pkg>/tsconfig.host.json` |
| `constraints` 报 node_modules 噪音 | 一堆 `must set "private": true` | 先 `git stash` 跑基线确认是既有的，再按路径过滤 |
| mixed native 包 | `must mark the Cordis peer as optional` / `files must be [...]` | 同时声明 peer + dev + `peerDependenciesMeta.optional`；`files` 必须精确等于 `lib/index.js`、`lib/native.js`、`lib/types/**/*.d.ts`（有 invariant 时加 `lib/invariant.js`） |
| Native 源不得引用 Cordis 包根 | `native source cannot reference @redspark/...` | 改用该包的 `/native` 子路径，并把子路径登记进 `native-package-policy.ts` 的两张表 |
| `gh run view --log-failed` 在 run 未结束时拒绝 | 看不到失败 | 用 `gh api .../actions/jobs/<id>` 取 steps 定位失败步骤 |

## 6. 验证命令

```powershell
$env:PATH = 'C:\Program Files\Git\bin;' + $env:PATH
$env:RSH_EXAMPLE_MODE = 'lib'

pnpm exec vitest run --config vitest.snapshot.config.ts snapshots/native-headless/
pnpm exec vitest run --config vitest.snapshot.config.ts snapshots/session/headless.snapshot.ts
pnpm run typecheck
pnpm run lint:contracts-ready
pnpm exec tsx rsh/Scripts/verify-native-dependencies.ts
pnpm exec tsx rsh/Scripts/verify-export-jsdoc.ts
pnpm run verify-agent-note-format
pnpm run verify-translation-pairing
```

CI 必需检查（4 项全绿才能 merge）：SPH / ubuntu-24.04、SPH / windows-2025、SPH packed / ubuntu-24.04、SPH packed / windows-2025。

## 7. 当前基线

| 套件 | 结果 |
|---|---|
| `snapshots/native-headless/` | 37 通过 / 0 失败（35 个文件） |
| `snapshots/session/headless.snapshot.ts` | 与本任务无关的 7 个既有失败仍在 |
| `native-headless` 单元 | 44 通过 |
| `native-tools` 单元 | 34 通过 |
| `hooks/*/tests/native.spec.ts` | 12 通过（仅 Linux 通道） |
| `pnpm run typecheck` / `lint:contracts-ready` | 全绿 |

## 8. 硬性禁令

- 绝不为让测试通过而改 fixture 或放宽断言。`RSH_SNAPSHOT=refresh` 只在确认 fixture 需随代码更新时用，且必须逐行 review。
- 绝不运行 `pnpm run test:snapshot:record`。
- 不硬编码 Git Bash / 部署路径。
- 不改 `read_file`/`write_file`/`pwsh`/`present` 的工具名。
- 不动用户的 DSH 安装目录与 `D:\DSH-Plugins`。
- 删除文件用回收站，仅构建产物用 `rm`。
- 反向控制不要用 `git checkout` 整文件回退。
- 每个非平凡改动必须带 Agent Note（`.md` + `.zh.md` + `.i18n.yaml`）。

## 9. Loop 目标

```
目标：让 snapshots/session/ 的 86 个场景全部在 Native profile 下通过，
      然后删除 Cordis 兼容层及其全部冗余副本。

验收：
1. 每个迁移场景的 Native 事件序列与其录制一致（有 diff 证据）
2. 每批迁移一个 PR，CI 四项必需检查全绿
3. 86/86 场景脱离 legacy-headless 可运行
4. 110 个 Cordis-only 包逐个给出「已迁移」或「随 Cordis 删除」的结论
5. Cordis 删除后全仓 CI 全绿

每轮：
- 先跑基线确认没有回归
- 挑当前阻塞点（按 §3 顺序），做完一个就提交 + 开 PR
- PR 全绿就 merge，不等人工 review
- 每轮结束更新本文档 §2 与 §7
```

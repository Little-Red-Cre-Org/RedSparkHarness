# Agent Note: Python 运行时只分发其声明闭包

Status: implemented

[English](2026-10-18-python-runtime-declared-closure.md) | 中文

## 问题

单文件 Python SDK 运行时用 `pnpm deploy --legacy --prod` 部署 [`dsh-python-runtime-closure`](../../../../rsh/Programs/SDK/python/sdk-runtime/package.json)。该命令会把 CLI 包的 `optionalDependencies` 提升上来，因此无论部署根目录声明了什么，暂存树都会带上整套旧 Cordis 装配与兼容组合包。只撤销这些声明并不改变产物：包仍然到来、仍然占据目录树、仍然进入可执行文件。一个不能决定产物的声明清单，无法成为「exe 安装哪些插件」的唯一真源。

## 决策

把暂存树裁剪到已声明闭包。在部署之后、资源打包之前，[`rsh/Scripts/python-runtime-closure-prune.ts`](../../../../rsh/Scripts/python-runtime-closure-prune.ts) 从部署根目录声明的依赖出发，跟随运行时真正能解析的每条邻接关系——`dependencies`、非可选 `peer`，以及保留包以值导入的可选 `peer`——删除每个不可达的包，移除 `.pnpm` 存储，并删除保留包下的嵌套 `node_modules`。

走的是运行时实际解析的范围，而不是 manifest 承诺的范围。最初的一版只跟随必需的 `peer`，于是删掉了 `@deepseek-ai/dsh-scope`：`dsh-agent-presets` 以值导入它，却只把它声明为可选 `peer`，打包后的可执行文件随即在导入时失败。现在除可选旧 Cordis 装配外，每个 `peer` 都计入，裁剪后的检查也遵循同一规则，两者不会再互相矛盾。

部署根目录改为声明可达闭包，而不是超集：36 条没有任何已发布 profile 或保留包需要的声明被移除，22 个此前缺失的可达包被补入（session-format 家族、存储、工作区、agent-presets、native-approval 等）。`verify-runtime-closure.ts` 相应增加反向等价检查，使没有落点的声明在门禁处失败，而不是悄悄扩大产物。

保留三个 Cordis 包：`cordis`、`dsh-cordis-host-runner`、`dsh-tool-cordis`。已发布的 `cordis` agent preset 会刻意挂载它们，因为它正是编辑实时组合的那个 preset。其余 Cordis 包全部移除；只要有包在该集合之外存活，构建就失败。

## 备选方案

**撤销声明并让 deploy 跟随。** 不予采纳。`--legacy` 部署会提升 CLI 包的可选依赖：目录树仍保留旧装配，于是 wheel 与可执行文件仍会携带它，而测量结果描述的是 manifest 而不是产物。

**按名单删除已知旧包。** 不予采纳。名单编码的是今天的排除项，而不是让运行时继续工作的闭包；下一个加入 preset 的包会从产物中悄悄消失。

**用同一部署根目录分发兼容发行。** 不予采纳。两种发行做出相反的承诺。Python 运行时是 native-only 载体；兼容发行通过 `@deepseek-ai/dsh` 保留自己的打包路径，其 49 个可选依赖——包括各 Cordis 包与 `dsh-app-boot`——未被改动，因此显式开启 Cordis 仍可打包。

## 影响

裁剪后的树保留 212 个 `@deepseek-ai` 包，没有链接、没有 `.pnpm`、没有嵌套 `node_modules`。被裁剪的 CLI 叶子会以 `dsh: compatibility mode requires optional packages` 拒绝 legacy profile，因为兼容模式需要本发行刻意省略的包。因此针对随包载体的 Python `legacy-sdk` 启动用例转为跳过，并写明该原因，而不是断言产物已不再承载的组合。

patch 行会整体替换某条 installation 的 `config` 值，所以只设置 `systemPrompt` 的 patch 同时会丢掉模板的 `maxSteps`。`sdk` profile 模板配置 `deepseek-v4-flash`，与 Python SDK 默认值一致。这两点都由通过可执行文件与开发期 node 闭包启动 `sdk` profile 的随包运行时测试固定。

本决策之外的待清理项：裁剪无条件移除 `.pnpm`、删除嵌套 `node_modules` 前不校验其内容、dry run 无法预先检查，以及 `coalesce-staged-dsh-tools.ts` 把非 `ENOENT` 错误报告为静默跳过。

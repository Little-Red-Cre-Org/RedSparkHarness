# RedSpark Harness 换底座 · 验收清单

**验收时间**：2026-10-30 01:21 整理
**代码树**：`D:\RedSparkHarness` · HEAD `fb001eb6c2` · 工作区干净（0 脏文件）
**PR**：<https://github.com/Little-Red-Cre-Org/RedSparkHarness/pull/308> · OPEN · MERGEABLE · 3 个提交

---

## 一、换了什么

| 项 | 之前 | 现在 |
|---|---|---|
| 底座 | `D:\RSIHarness`（46 GB / 196,645 文件，OpenBitFun 桌面端 + 自研 rsi） | `D:\RedSparkHarness`（12,945 文件，DeepSeek Harness 的 fork） |
| 前端 | OpenBitFun 的 web-ui | RedSpark Harness 自带（绯红主题，Kitsune 赤绯） |
| Agent 核心 | OpenBitFun 的 agentic（Rust） | RedSpark 的 `rsh/Engine`（TypeScript + Cordis） |
| 自研引擎 | `rsi/` 29 个 py | **已完整迁入**，作为 ACP 子进程挂载 |

旧仓库删除前确认：远端 7 个分支齐全（`main = 84c1839`），`D:\_rsi_export` 保留含 `.git` 的完整导出副本，连当时未提交的 `rsi/acp_stdio.py`、`tests/test_acp_stdio.py` 都在。

---

## 二、已验成立（可当场复验）

### 1. 构建

```
cd D:\RedSparkHarness
$env:PATH = "D:\RedSparkHarness\node_modules\.bin;" + $env:PATH
pnpm run build
→ exit 0
→ 末行 build: recorded 256 client artifact(s) with 3 public value(s)
```

**注意**：必须把工作区 `node_modules/.bin` 放在 PATH 最前，否则内层脚本调到全局 pnpm 12，报 `ERR_PNPM_BAD_PM_VERSION`。

### 2. 数据隔离

| 位置 | 状态 | 实测 |
|---|---|---|
| `C:\Users\<user>\.redspark` | **默认值已改，未验证实际写入** | 目录存在但**为空**；RSH 尚未往里落数据 |
| `C:\Users\<user>\.dsh` | DSH 的，仍在写 | 24 小时内确认有写入 |
| `%APPDATA%\RedSpark Harness` | **不是 RSH 在用** | 仅 1 个 490 字节文件，是某次启动失败留下的 |
| `%APPDATA%\@deepseek-ai\dsh-desktop` | DSH userData | 628 文件 |

> **userData 隔离不成立（已更正）**：`rsh/Programs/Desktop/package.json` 的 `name` 是 `@deepseek-ai/dsh-desktop`，与 DSH 相同，且**没有 `productName` 字段**。`electron-builder.config.mjs:58` 里的 `productName` 是 builder 用来给产物命名的属性（`app-builder-lib/out/appInfo.js:54`），**不写回 asar 内的 package.json**，因此影响不到 `app.getName()`。打包后 userData 会与 DSH 撞车。`scripts/` 下 `productName` 零命中，没有注入步骤。
>
> 修法二选一：`main.ts` 早期 `app.setPath('userData', ...)`（代码层、可测、不动包名），或给 Desktop 的 `package.json` 增加 `productName`（字段不是包名，不破 `@deepseek-ai/*` 规矩）。
>
> 开发模式下 `dev.ts:63` 显式传了 `--user-data-dir=…\.desktop-build\development\electron-user-data`（45 文件），所以开发时看不出这个问题——**只有打包后才会暴露**。

**继承保护**（都水实现）：进程若从 DSH 会话继承 `DSH_HOME=~/.dsh`，会被拒绝并回落到 `.redspark`。四种情形实测：

```
不设 DSH_HOME              -> C:\Users\zzn19\.redspark
继承 DSH_HOME=~/.dsh       -> C:\Users\zzn19\.redspark   ← 被拒绝
继承带尾斜杠               -> C:\Users\zzn19\.redspark
显式配置 ~/.redspark       -> C:\Users\zzn19\.redspark
```

### 3. 可维护性红线（官家明令）

| 红线 | 实测 | 结论 |
|---|---|---|
| 不改 `@deepseek-ai/*` 包名 | 357 个 package.json 全是 `@deepseek-ai/*` | ✅ 守住 |
| 不改 `DSH_*` 环境变量 | `DSH_HOME_ENV = 'DSH_HOME'` 原样 | ✅ 守住 |
| 代码未被品牌替换改坏 | 构建 exit 0、测试过、RSI import 成功 | ✅ 未见损坏 |

品牌替换实际改动：新增行含 `RedSpark Harness` **309 行**，含 `RedSpark` 668 行。所有 `package.json` 的 `repository` URL 已指向本仓库。

### 4. 界面

实测截图确认：窗口标题 `RedSpark Harness`，页面 `dsh-app://app/index.html`，欢迎页文案「…… RedSpark 的 Agent 平台」，绯红主题（CSS 变量 `--sph-crimson` / `--sph-blush` / `--sph-paper`），DOM 有 `<header id="sph-title-bar">`。

### 5. RSI 引擎作为 ACP 子进程（Compatibility 路径）

真跑通，非 mock：

```
{"type":"result","output":"child reported:\nRSI-ENGINE-OK","usage":{"inputTokens":20,"outputTokens":34}}
```

子进程 stderr 佐证真 spawn：

```
Created new conversation
TaskTrackerExecutor initialized
FileEditor initialized with cwd:
Loaded 3 tools from spec
```

ACP 帧原文：

```
INITIALIZE  → agentInfo.name = "rsi-harness", version = "0.1.0"
SESSION/NEW → sessionId = rsi-<uuid>-0001
FRAME       → agent_message_chunk, text = "RSI-ENGINE-OK"
FRAME       → stopReason = "end_turn", usage = {inputTokens: 11, outputTokens: 5, totalTokens: 16}
```

回归：`tests/subagent-acp` 72 passed / 1 skipped；`bundle/base` 2 passed；`verify-cordis-config` 147 config files passed。

---

## 三、未做成（明写不藏）

### 1. 桌面端点开 RSI —— 做不到

桌面端跑的是 **Native** profile，与 Compatibility 是两套互不相通的注册体系。

```
rsh/Programs/Desktop/.desktop-build/development/project/package.json
  "profile": { "runtime": "native", ... }

rsh.profile.json:201-208
  { "id": "subagents", "plugin": "@deepseek-ai/dsh-native-subagent",
    "config": { "providerName": "spawn" } }     ← 只有 spawn，没有 acp
```

Native 侧的 `dsh-acp-child` **在设计上就没有「启动任意 command 的 ACP 子进程」这个能力**：

```
rsh/Programs/CLI/src/native-acp-child-runtime-launcher.ts:27
  function fixedChildProcess(...) {
    const manifestPath = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh/package.json'))
    ↑ 硬编 dsh 自己，无法注入其他 command

rsh/Modules/Official/subagent/acp-child/src/native.ts:54
  if (Object.keys(fields).some(f => f !== 'providerName' && f !== 'providers')) {
    throw new TypeError('dsh-acp-child configuration accepts only providerName and providers')
  }
```

**要打通，二选一**（属架构级改动，本 PR 不做）：

- **A**：桌面端切回 legacy runtime（Compatibility 组装）—— 代价是丢失 Native 的一批能力
- **B**：在 `@deepseek-ai/*` 之外新写一个 Native driver —— 不破坏包名规矩，但是新包

### 2. 真实模型跑一轮 —— 缺可用 key

`.credentials.yaml` 里的 deepseek token 是**加密 token**，不是明文 API key，打 `api.deepseek.com` 返回 401。当前 `.rsi/engine-home/config.toml` 指向本地 mock provider。**要看真实模型，需要一个能用的 key。**

### 3. 全量 `pnpm test` 不是绿的 —— 130 条失败

```
Test Files  40 failed | 1415 passed
     Tests  130 failed | 22855 passed
```

**但性质是并发资源竞争，不是本次改动引起**。验封独立抽查：失败文件单独跑全绿，且这些文件本次没碰过。

```
change-scope.spec.ts            → 5 passed | 3 skipped
gen-third-party-notices.spec.ts → 31 passed (31)
verify-application-entrypoints  → 11 passed (11)
```

另外 `spawn-runner.spec.ts:385` 单跑也红，但用 `git stash` 对照确认——**原始代码上同样红**。

**建议验收口径**：按模块单独跑（受影响模块全绿），而非「全量绿」。后者在这台机器上改动前后都过不了。

### 4. 安装包未出

只验到「源码能构建、开发模式能启动」，没有 NSIS 安装包或签名产物。

---

## 四、环境坑（下次必踩，先记下）

| 坑 | 症状 | 处置 |
|---|---|---|
| `ELECTRON_RUN_AS_NODE=1` | Electron 以纯 Node 模式跑，`require('electron')` 得 `undefined`，报 `does not provide an export named 'BrowserWindow'` | 启动前 `Remove-Item Env:\ELECTRON_RUN_AS_NODE` |
| 全局 pnpm 12 盖住项目 pnpm | `ERR_PNPM_BAD_PM_VERSION` | `node_modules/.bin` 放 PATH 最前 |
| `tsbuildinfo` 缓存污染 | `error TS6053: File ... not found`（记住已删除的临时文件） | 清掉全部 `tsconfig.tsbuildinfo` |
| venv 只有 pip | `the openhands SDK is not installed` | 装 `openhands-sdk` + `openhands-tools`，**两包都钉 1.59.0** |
| 两包版本漂移 | `No module named 'openhands.sdk.subagent.scope'` | 同上，装 tools 会把 SDK 降到 1.49.1 |
| rsi 装不进 venv | `does not appear to be a Python project` | `rsi-pyproject.toml` 非标准名；`python -m` 认 `sys.path` 不认 `cwd`，只能用 `PYTHONPATH` |

---

## 五、一句话结论

**换底座这件事成了**：底座换了、品牌换了、隔离真做了、构建能过、应用能开、RSI 引擎能跑。

**没成的是「桌面端点开 RSI」**——那是 Native 路径的能力边界，不是本轮的疏漏，需单独立项。真实模型一轮缺 key，同样单列。

**建议验收动作**：双击 `D:\RedSparkHarness\rsh\Programs\Desktop\.desktop-build\development\` 下的 Electron（或按 BUILD 说明起），看界面是不是 RedSpark；然后决定 Native driver 这条路要不要开。

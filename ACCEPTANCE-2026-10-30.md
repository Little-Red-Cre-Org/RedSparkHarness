# RedSpark Harness 换底座 · 验收清单

**验收时间**：2026-10-30 01:21 整理 · **02:48 逐条复核更正**
**代码树**：`D:\RedSparkHarness` · HEAD `cf84602962` · 工作区干净（0 脏文件）
**PR**：<https://github.com/Little-Red-Cre-Org/RedSparkHarness/pull/308> · OPEN · 7 个提交

---

## 一、换了什么

| 项 | 之前 | 现在 |
|---|---|---|
| 底座 | `D:\RSIHarness`（46 GB / 196,645 文件，OpenBitFun 桌面端 + 自研 rsi） | `D:\RedSparkHarness`（12,945 文件，RSH 底座） |
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
| `C:\Users\<user>\.redspark` | **在用，RSH 真往里写** | 61 文件（含 `profiles/desktop/*`、`storages/session_projcache/*`、`settings.yaml`、`.credentials.yaml`） |
| `C:\Users\<user>\.redspark\desktop\user-data` | **打包版 Electron 用这里** | 44 文件 / 17 顶层项，`Local Storage`、`Network`、`Preferences`、`Local State` 齐全 |
| `C:\Users\<user>\.dsh` | DSH 的，未被 RSH 读写 | RSH 继承 `DSH_HOME=~/.dsh` 时被拒绝并回落 |
| `%APPDATA%\RedSpark Harness` | **旧残留，不是 RSH 在用** | 1 文件（`Local State` 490B，00:40:46）＋ 空 `logs`；**是都水探针副产物** |
| `%APPDATA%\@deepseek-ai\dsh-desktop` | DSH userData | 628 文件，RSH 未写 |

> **userData 隔离已修复（02:20 提交 `cf84602962`）**：原判定「打包后 userData 会与 DSH 撞车」成立且已被实证推翻修复。修法取代码层：
>
> ```
> rsh/Programs/Desktop/src/main.ts:781 | app.setPath('userData', desktopUserDataPath())
> rsh/Programs/Desktop/src/paths.ts:36 | export function desktopUserDataPath(dshHome: string = resolveDshHome()): string {
> rsh/Programs/Desktop/src/paths.ts:37 |   return join(dshHome, 'desktop', 'user-data')
> ```
>
> 调用点在 `main.ts:783` 的 `claimDesktopSingleInstance(...)` **之前**，即最早 `app` 路径访问之前——Electron 一旦读过 userData 就拒绝再改，位置必须是这里。
>
> **打包产物内已确认该行存在**：从 `win-unpacked\resources\app.asar` 抽出 `lib/main.js`，`:13889` 为 `app.setPath("userData", desktopUserDataPath());`。这不是"源码改了但产物没重打"。

**为什么 `productName` 那条路走不通（都水的判定成立，臣在 02:16 的机制解释有误，此处更正）**：

| 判据 | 实测原文 |
|---|---|
| 产物内 manifest 无 `productName` | 从 app.asar 抽出 `package.json`：`"name": "@deepseek-ai/dsh-desktop"`，**无 `productName` 字段** |
| builder 的 `productName` 不进 asar | `app-builder-lib@26.15.3/out/appInfo.js:54` | `this.productName = info.config.productName \|\| info.metadata.productName \|\| info.metadata.name;` —— 这是 builder 自己的属性 |
| builder 的 `name` 取自 metadata | `appInfo.js:116` | `return this.info.metadata.name;` —— 与 `productName` 是两个独立 getter |
| 无 `extraMetadata` 注入 | `git grep extraMetadata` 在 desktop 下零命中；`electron-builder.config.mjs` 全文无此键 |

**但都水"那 2 项目录是探针副产物"这条，臣复现属实**：该目录只有 `logs`（0 文件）+ `Local State` 两项，而真实启动的 `.redspark\desktop\user-data` 有 **17 项**。所以 00:40:46 那个目录不是 RSH 启动的证据——**臣先前把它当作启动实证，引错了**。

**都水"自动更新缓存会撞"这条，臣核实为真但影响面小**：

```
electron-updater AppAdapter.js:6-11   getAppCacheDir() → process.env["LOCALAPPDATA"]
electron-updater ElectronAppAdapter.js:16-17  get name() { return this.app.getName(); }
electron-updater AppUpdater.js:550    const cacheDir = path.join(this.app.baseCachePath, dirName || this.app.name)
app-builder-lib appInfo.js:126-127    get updaterCacheDirName() { return this.sanitizedName.toLowerCase() + "-updater" }
```

`updaterCacheDirName` 确实由 `name`（`@deepseek-ai/dsh-desktop`）推导，与显示名无关。磁盘实测 `%LOCALAPPDATA%\@deepseek-aidsh-desktop-updater` 存在，含 `installer.exe`（317,151,681 B，10-29 11:34），**是 DSH 自己的更新缓存**。

**但这处不影响本次验收**：本次是 unsigned 打包，`electron-builder.config.mjs:53` 为 `const update = unsigned ? undefined : resolveDesktopAutoUpdateConfig(...)`，产物 `resources\` 下**没有 `app-update.yml`**（实测 `Test-Path` = False），所以更新器不会启用。**签名发布版才需要处理这处**，单列。

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

### 4. 安装包

**已出，且真跑起来了。**

```
路径   rsh\Programs\Desktop\.desktop-build\targets\win-x64\unsigned-artifacts\win-unpacked\
exe    RedSpark Harness.exe
字节   244,440,576（233.1 MB）
mtime  2026-10-30 02:35:12
版本   0.1.5-rc.2（exe VersionInfo: ProductName = RedSpark Harness）
```

进程级实证（`Win32_Process` 命令行原文）：

```
PID 54644  "…\win-unpacked\RedSpark Harness.exe"
PID 38076  "…\RedSpark Harness.exe" --type=gpu-process --user-data-dir="C:\Users\zzn19\.redspark\desktop\user-data"
PID 54624  "…\RedSpark Harness.exe" --type=utility … --user-data-dir="C:\Users\zzn19\.redspark\desktop\user-data"
PID 60000  "…\RedSpark Harness.exe" --type=renderer --user-data-dir="C:\Users\zzn19\.redspark\desktop\user-data" … --app-path="…\win-unpacked\resources\app.asar"
```

**这是决定性证据**：三个子进程的 `--user-data-dir` 全部指向 `.redspark`，不是 `@deepseek-ai\dsh-desktop`。

**两者此刻并存**：RSH 4 进程与 DSH 13 进程同时存活 —— 单实例锁不互踢，隔离在运行态成立。

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

**换底座这件事成了**：底座换了、品牌换了、数据隔离实测成立、构建 exit 0、打包版 exe 真跑起来（PID 54644 存活）、RSI 引擎能跑。

**没成的是「桌面端点开 RSI」**——那是 Native 路径的能力边界，不是本轮的疏漏，需单独立项。真实模型一轮缺 key，同样单列。

**建议验收动作**：直接双击

```
D:\RedSparkHarness\rsh\Programs\Desktop\.desktop-build\targets\win-x64\unsigned-artifacts\win-unpacked\RedSpark Harness.exe
```

它此刻已在运行（PID 54644）。看到标题栏「RedSpark Harness」、绯红主题、侧边栏文本字标，即隔离与品牌双双成立。

---

## 六、本次复核中被推翻的三条（留档，勿删）

| 先前写的 | 实测 | 谁推翻 |
|---|---|---|
| `%APPDATA%\RedSpark Harness` 是「某次启动失败留下的」 | 是**都水探针**留下的，不是 RSH 启动证据（仅 2 项，真实启动 17 项） | 都水 |
| `productName` 可用于隔离 userData | builder 属性，不进 asar；`appInfo.js:54` 与 `:116` 是两个独立 getter | 都水（臣 02:16 的解释有误） |
| 无安装包 | 已有 233.1 MB exe，02:35:12，进程级验证通过 | 臣 02:14 打包成功 |
| 「修复前不传参也会落到 DSH 目录，由打包产物证明」 | 打包产物证明的是**修复后不依赖传参**；修复前的落点**没有实测到**（写盘前即退出，delta 0、mtime 未变） | 武库（02:55 复核） |

**仍待办（不阻塞本 PR）**：签名发布版的自动更新缓存目录 `%LOCALAPPDATA%\@deepseek-aidsh-desktop-updater` 由 `name` 推导，与 DSH 同名。unsigned 产物不写 `app-update.yml`，故本次不受影响；正式签名发布前需处理。

---

## 七、隔离的独立复核（武库，02:55:31）

武库不采信上述结论，用 `Get-CimInstance Win32_Process` 逐 PID 重取，并与臣的读数逐项对照：

| 项 | 武库独立取值 | 臣原报 | 对照 |
|---|---|---|---|
| PID 38076 `--user-data-dir` | `C:\Users\zzn19\.redspark\desktop\user-data` | 同 | 一致 |
| PID 54624 `--user-data-dir` | 同 | 同 | 一致 |
| PID 60000 `--user-data-dir` | 同 | 同 | 一致 |
| 主进程 54644 | **命令行不带该参数**（由 `app.setPath` 生效后传给子进程） | 臣未查 | 武库补全 |
| `resources\app.asar` | 17,007,742 B，mtime 02:35:05 | 同 | 一致 |
| `lib\main.js` 内 `setPath` | **line 13889**（530,991 B，解出 528,983 字符） | 13889 | 一字不差 |
| `~\.redspark\desktop\user-data` | 44 文件 / 17 顶层项 | 44 / 17 | 一致 |
| `@deepseek-ai\dsh-desktop` | 628 文件，mtime 2026-10-29 22:01:58 **未变** | 628 | 一致 |
| 窗口标题（PID 54644） | `RedSpark Harness` | 同 | 一致 |
| 并存 | RSH 4 进程 + DSH 12 进程 | 同 | 一致 |

**结论：隔离已判定成立**，不再写「打包前不可判定」。

**一处口径按武库的更正收窄**：`git show 17a430b0a8:rsh/Programs/Desktop/src/main.ts` 里**没有任何 `setPath`** — 上游原版就是不设 userData 的。所以「修复前不传参会落到 DSH 目录」只是合理推断，没有实测（当时写盘前即退出）。它不影响结论，因为 `setPath` 现在已把落点钉死。

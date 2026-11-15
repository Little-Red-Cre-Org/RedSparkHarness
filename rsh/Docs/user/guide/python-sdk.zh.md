# Python SDK 入门

[English](python-sdk.md) | 中文

本教程安装已发布的 Python SDK，运行随附的独立极简 profile，并说明如何从自己的程序自定义同一个 `dsh` profile。

## 前置条件

- Python 3.10 或更高版本
- Git
- Linux x64、Linux arm64、arm64 上的 macOS 14 或更高版本，或 Windows x64
- DeepSeek 兼容的 API endpoint 与凭据
- 隔离的 workspace 与隔离的 Harness home

## 安装 SDK

### Linux 与 macOS

```sh
git clone https://github.com/deepseek-ai/redspark-harness.git
cd redspark-harness
python -m venv .venv
. .venv/bin/activate
python -m pip install redspark-harness-sdk
```

### Windows PowerShell

```powershell
git clone https://github.com/deepseek-ai/redspark-harness.git
Set-Location redspark-harness
py -3.10 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install redspark-harness-sdk
```

安装内容包含匹配的原生运行时 wheel 与 `dsh` 命令。普通 SDK 运行不需要系统 Node.js。需要构建产物的仓库贡献者应使用 [Python 贡献者工作流](../../../Programs/SDK/python/development.zh.md)。

## 运行检入示例

导出凭据；使用兼容代理时再设置 endpoint：

### Linux 与 macOS

```sh
export DEEPSEEK_API_KEY=sk-your-key-here
# export DEEPSEEK_BASE_URL=http://127.0.0.1:8000/v1
```

### Windows PowerShell

```powershell
$env:DEEPSEEK_API_KEY = "sk-your-key-here"
# $env:DEEPSEEK_BASE_URL = "http://127.0.0.1:8000/v1"
```

使用显式 workspace 与 home 路径运行一个任务：

### Linux 与 macOS

```sh
python rsh/Programs/SDK/python/sdk/examples/minimal.py \
  --workspace /absolute/path/to/disposable-workspace \
  --dsh-home /absolute/path/to/example-dsh-home \
  --session-id example-001 \
  "Inspect the repository and fix the failing tests."
```

### Windows PowerShell

```powershell
python rsh/Programs/SDK/python/sdk/examples/minimal.py `
  --workspace C:\work\disposable-workspace `
  --dsh-home C:\work\example-dsh-home `
  --session-id example-001 `
  "Inspect the repository and fix the failing tests."
```

脚本会打印最终 assistant 响应。所选 home 会保存生成的 `sdk` profile、已安装插件，以及 `sessions/` 下的未压缩 JSONL 会话日志。示例与 SDK 绝不会静默读取 `~/.dsh`。

## 在程序中使用 SDK

```python
from pathlib import Path

from redspark_harness import RedSparkHarness

workspace = Path("/absolute/path/to/disposable-workspace").resolve()
rsh_home = Path("/absolute/path/to/example-dsh-home").resolve()
with RedSparkHarness(
    provider="deepseek-official",
    model="deepseek-v4-flash",
    max_tokens=49_152,
    cwd=str(workspace),
    rsh_home=str(rsh_home),
    profile="sdk",
) as harness:
    result = harness.run(
        "Inspect the repository and fix the failing tests.",
        session_id="example-001",
    )

print(result.final_response)
```

SDK 会延迟启动内置的 `dsh --profile sdk` 进程，并复用到上下文管理器退出。Profile、其持久 patch、home patch 与任何有序 `patches` tuple 共同组成应用配置。不存在独立 Python 运行时 bin 或完整配置选项。

## 安装插件

受支持的 SDK profile 是 `sdk`。启动器在启动、导出配置、插件管理和 `--from-default-profile` 上拒绝 `sdk-minimal`。已有目录不会被改写。不要用 `--dump-default-config` 初始化它，也不要对它应用 Cordis `insert`。见[原生配置迁移](../../native-config-migration.zh.md)。

另一个 `profile` 只有在其组合包含 JSON-RPC server 时才有效。缺失 server 配置项、无法解析的插件和非法 patch 会在启动时失败，不会回退到其他组合。

<a id="opt-in-to-str_replace_editor"></a>

### `str_replace_editor`

已退役的 `sdk-minimal` profile 不包含 `str_replace_editor`，并曾接受一段 Cordis insert 来添加它。该启动方式已被拒绝。本指南不向 `sdk` 添加这个 editor。

## 示例选择的 profile

`minimal.py` 选择 `sdk`。模型来自 `--model`，然后是 `RSH_MODEL`，最后是 `deepseek-v4-flash`。系统提示词来自 `RSH_SYSTEM_PROMPT`，未设置时为 `You are a helpful software engineer assistant.`。会话日志是 `<rsh_home>/sessions` 下的未压缩 JSONL。

`sdk` 初始化为 native-sdk 组合。它包含按平台选择的持久 shell 和本地文件系统 provider，并固定使用 `danger-full-access`。应使用一次性 checkout 或容器。已退役的独立配置树不再是受支持的启动方式。

已安装 wheel 仍会打包完整 `web` profile 与前端产物。如果 Python SDK 部署还需要浏览器应用，请针对显式 `RSH_HOME` 运行 `dsh web`；`web` 是独立 CLI 应用，不能为 Python SDK client 提供服务。

需要隔离 profile、插件、凭据、设置与会话时，应使用新的 home。独立工作应使用新的 session id；只有继续同一段持久对话和会话资源时，才同时复用 harness、home 与 id。

[组合包参考](../../../Compatibility/DSH/bundle/sdk-minimal/README.zh.md)描述已退役的包。[示例参考](../../../Programs/SDK/python/sdk/examples/README.zh.md)定义可运行程序，该程序选择 `sdk`。[Python SDK 参考](../../../Programs/SDK/python/sdk/README.zh.md)介绍生命周期、结果、通知与底层行为；[dsh CLI 参考](../../../Programs/CLI/reference/README.zh.md)介绍 profile 分层。

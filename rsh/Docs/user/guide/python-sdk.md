# Get started with the Python SDK

English | [中文](python-sdk.zh.md)

This tutorial installs the published Python SDK, runs the shipped standalone minimal profile, and shows how to customize the same `dsh` profile from your own program.

## Prerequisites

- Python 3.10 or newer
- Git
- Linux x64, Linux arm64, macOS 14 or newer on arm64, or Windows x64
- A DeepSeek-compatible API endpoint and credential
- An isolated workspace and an isolated Harness home

## Install the SDK

### Linux and macOS

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

The installation includes a matching native runtime wheel and the `dsh` command. Normal SDK execution needs no system Node.js. Repository contributors who build the artifacts should use the [Python contributor workflow](../../../Programs/SDK/python/development.md).

## Run the checked-in example

Export the credential and, when needed, a compatible proxy endpoint:

### Linux and macOS

```sh
export DEEPSEEK_API_KEY=sk-your-key-here
# export DEEPSEEK_BASE_URL=http://127.0.0.1:8000/v1
```

### Windows PowerShell

```powershell
$env:DEEPSEEK_API_KEY = "sk-your-key-here"
# $env:DEEPSEEK_BASE_URL = "http://127.0.0.1:8000/v1"
```

Run one task with explicit workspace and home paths:

### Linux and macOS

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

The script prints the final assistant response. The selected home receives the generated `sdk` profile, installed plugins, and uncompressed JSONL session logs under `sessions/`. The example and SDK never silently read `~/.dsh`.

## Use the SDK in your program

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

The SDK starts the bundled `dsh --profile sdk` process lazily and reuses it until context-manager exit. The profile, its persistent patch, the home patch, and any ordered `patches` tuple form the application configuration. There is no separate Python runtime bin or complete-config option.

## Install plugins

The supported SDK profile is `sdk`. The launcher refuses `sdk-minimal` on boot, dump, plugin management, and `--from-default-profile`. Existing directories are not rewritten. Do not initialize it with `--dump-default-config`, and do not apply a Cordis insert to it. See [native configuration migration](../../native-config-migration.md).

Another `profile` is valid when its composition includes a JSON-RPC server. Missing server rows, unresolved plugins, and invalid patches fail during startup instead of falling back to another composition.

<a id="opt-in-to-str_replace_editor"></a>

### `str_replace_editor`

The retired `sdk-minimal` profile omitted `str_replace_editor` and accepted a Cordis insert that added it. That launch is refused. This guide does not add the editor to `sdk`.

## What the example selects

`minimal.py` selects `sdk`. The model comes from `--model`, then `RSH_MODEL`, then `deepseek-v4-flash`. The system prompt comes from `RSH_SYSTEM_PROMPT`, falling back to `You are a helpful software engineer assistant.` Session logs are uncompressed JSONL under `<rsh_home>/sessions`.

`sdk` initializes as the native-sdk composition. It includes the platform persistent shell and the local filesystem provider, and it pins `danger-full-access`. Use a disposable checkout or container. The retired standalone tree is not a supported launch.

The installed wheel still packages the full `web` profile and frontend assets. Run `dsh web` against an explicit `RSH_HOME` when a Python SDK deployment also needs the browser application; `web` is a separate CLI application and cannot serve a Python SDK client.

Use a fresh home when profiles, plugins, credentials, settings, and sessions must be isolated. Use a fresh session id for independent work; reuse a harness, home, and id only to continue the same durable conversation and session-owned resources.

The [bundle reference](../../../Compatibility/DSH/bundle/sdk-minimal/README.md) describes the retired package. The [example reference](../../../Programs/SDK/python/sdk/examples/README.md) owns the runnable program, which selects `sdk`. The [Python SDK reference](../../../Programs/SDK/python/sdk/README.md) covers lifecycle, results, notifications, and low-level behavior; the [dsh CLI reference](../../../Programs/CLI/reference/README.md) covers profile layering.

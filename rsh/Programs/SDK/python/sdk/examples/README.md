# Python SDK example

English | [中文](README.zh.md)

Runnable Python SDK example over the sole application launcher, `dsh --profile sdk`. The Python client owns JSON-RPC stdio; the profile owns the agent composition, persistence, execution policy, and plugins.

## Run the example

Install `redspark-harness-sdk`, export a model credential, then supply an isolated Harness home and workspace:

```sh
export DEEPSEEK_API_KEY=sk-your-key-here
python rsh/Programs/SDK/python/sdk/examples/minimal.py \
  --dsh-home /absolute/path/to/example-dsh-home \
  --workspace /absolute/path/to/disposable-workspace \
  --session-id example-001 \
  "Inspect the repository and fix the failing tests."
```

Set `DEEPSEEK_BASE_URL` for a compatible proxy, `RSH_MODEL` for the script's default model, or `RSH_SYSTEM_PROMPT` for the deployment persona. `--model` is the single runtime model selection; no matching environment variable is required. `--profile` can select another SDK-serving profile. The selected home stores the initialized `sdk` profile and uncompressed JSONL session logs under `sessions/`; the script never reads `~/.dsh` implicitly.

`sdk` initializes as the native-sdk composition. It includes the platform persistent shell and the local filesystem provider, and it pins `danger-full-access`. Use a disposable checkout or container. The launcher refuses the profile name `sdk-minimal`. See the [Python SDK tutorial](../../../../../Docs/user/guide/python-sdk.md) and [native configuration migration](../../../../../Docs/native-config-migration.md).

## Add plugins

Install the package into the same explicit home's `sdk` profile directory with pnpm, then add an installation row that names it to that profile's `rsh.profile.json`:

```sh
export RSH_HOME=/absolute/path/to/example-dsh-home
cd "$RSH_HOME/profiles/sdk"
pnpm add file:/absolute/path/to/my-plugin-bundle
```

The plugin must publish a Native entry and declare it under `dsh.native`; see [package and install a Native plugin](../../../../../Docs/user/develop/basic/publish.md). The selected profile must retain a JSON-RPC server row. The example accepts no complete configuration file or arbitrary process argv. The same runtime wheel packages the `web` profile and its frontend assets for direct CLI use: `dsh web` starts that separate application. A Python SDK client cannot select `web` because it has no JSON-RPC server row.

See the [Python SDK tutorial](../../../../../Docs/user/guide/python-sdk.md) and [SDK reference](../README.md).

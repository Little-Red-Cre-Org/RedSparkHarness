# RedSpark Harness · SPH

English | [中文](README.zh.md)

RedSpark Harness (SPH) is RedSpark's agent platform, developed from [DeepSeek AI](https://deepseek.com)'s open-source project [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). RedSpark is our organization and the name reserved for our future model; no RedSpark model is available yet. Model providers retain their actual names.

Our desktop and Web interfaces share a crimson, warm-white and charcoal theme, a flame-and-star mark, and Kitsune (赤绯), our animated welcome-screen companion. Click her to wave; pause motion with the adjacent control. Reduced-motion preferences disable animation by default; Enable motion explicitly opts in for the current welcome screen. This is an in-app sprite companion, not a Live2D model or an operating-system overlay. The supplied RedSpark artwork belongs to the project identity; upstream copyright and license notices are retained. Internal `dsh` commands, `DSH_*` environment variables and package identifiers remain compatible with upstream.

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Upstream reference documentation (retained for development): [DeepSeek Harness docs](https://deepseek-harness.github.io/deepseek-harness/). Fork-specific delivery: [local acceptance guide](ACCEPTANCE.md).

## Developer preview

RedSpark CI checks builds, types and client tests on standard Linux/Windows runners, with Linux lint and documentation checks. Upstream release, deployment and provider automation is disabled in this repository pending integration setup; its definitions and attribution remain available. Ordinary Dependabot version-update PRs are paused; security alerts are retained. This baseline does not replace exhaustive upstream coverage, browser or real-API validation.

RedSpark Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run the upstream version from `npm`

This retained command installs upstream DeepSeek Harness, not the RedSpark fork. Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](rsh/Docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/Little-Red-Cre/RedSparkHarness.git
cd RedSparkHarness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

For the Electron desktop client, run `pnpm run start:desktop` after building. The development desktop keeps its own data under `rsh/Programs/Desktop/.desktop-build/development/home`. API keys are configured in the application, not in this repository.

## Upstream community and support

The following links belong to the upstream project and are retained as development resources. RedSpark changes are maintained in [our repository](https://github.com/Little-Red-Cre/RedSparkHarness).

- Submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Related projects

RedSpark maintains two repositories; they are separate projects, not a parent and a fork.

| | This repository | [RSI Harness](https://github.com/Little-Red-Cre-Org/RSI-Harness) |
|---|---|---|
| What it is | The Agent product: desktop, Web, TUI and SDK surfaces | The research effort that gives a harness a lifecycle |
| Built on | [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (TypeScript, Cordis plugins) | [Harness²](https://github.com/google-research/harness2) (Python) |
| What it optimises | Delivery: interface, model access, Sessions, presets | Generations of a harness: lineage, pointer, atomic switch, rollback |
| Language | TypeScript | Python |

Harness² optimises what a harness contains; RSI Harness adds how one generation becomes the next; this repository is the layer that turns the result into a product.

### The `rsi/` directory

`rsi/` in this repository is an **embedded copy** of the RSI Harness engine (29 files, 28 shared by name), so the product can call it without a second checkout. The two copies have diverged: this one renames the engine's `golden` assertion to `smoke`.

When changing the engine, change it in [RSI-Harness](https://github.com/Little-Red-Cre-Org/RSI-Harness) first and sync the result here; do not treat this copy as the source of truth.

## Development

Start with the [development guide](rsh/Docs/development.md) and [architecture documentation](rsh/Docs/architecture.md). For agents, follow [AGENTS.md](AGENTS.md).

### Prerequisites

Node.js `^22.19.0 || >=24.0.0` and pnpm. The repository pins its toolchain; `pnpm install` at the root installs every workspace package.

### Build and run

```bash
pnpm install
pnpm run build          # libraries, then the Web client
pnpm run dev:web        # the Web development server
```

The desktop application builds through its own entry points:

```bash
pnpm run package:desktop:win:x64:unsigned
```

### Check your change

```bash
pnpm run typecheck      # tsc -b across the whole graph
pnpm run lint           # oxlint, whole repository
pnpm run test           # unit and client tests
```

Repository gates run as `tsx rsh/Scripts/run-gates.ts <mode>`; `hygiene` and `doc-sync` are the two that catch structural and documentation drift.


## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Citation

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

See [LICENSING.md](LICENSING.md) for the layered license. Upstream DeepSeek Harness material remains MIT; original RedSpark material is under the RedSpark Restricted Evaluation License until an explicit post-publication MIT release. The RedSpark maintainers may publish papers and technical reports about RedSpark Harness; anyone else needs a separate written license to use RedSpark material for such publications.

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
# RedSpark Harness

This project is publicly viewable for software evaluation and attribution review. Licensing is intentionally layered: upstream DeepSeek Harness material remains MIT, while original RedSpark material is under the RedSpark Restricted Evaluation License, which restricts licensees (not the RedSpark maintainers) from academic, publication, and commercial use until the related technical report or formal paper is published and a release is explicitly marked MIT. See [LICENSING.md](LICENSING.md).

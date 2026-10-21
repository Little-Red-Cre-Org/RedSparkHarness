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

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

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

For the Electron desktop client, run `pnpm run start:desktop` after building. The development desktop keeps its own data under `apps/desktop/.desktop-build/development/home`. API keys are configured in the application, not in this repository.

## Upstream community and support

The following links belong to the upstream project and are retained as development resources. RedSpark changes are maintained in [our repository](https://github.com/Little-Red-Cre/RedSparkHarness).

- Submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

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

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

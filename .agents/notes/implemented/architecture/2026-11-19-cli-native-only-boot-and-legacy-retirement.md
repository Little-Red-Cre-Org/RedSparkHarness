# Agent Note: CLI boots only Native profiles and retires the dynamic Cordis surfaces

Status: implemented

English | [中文](2026-11-19-cli-native-only-boot-and-legacy-retirement.zh.md)

## Problem

The `dsh` launcher kept two boot paths in one package: a Cordis composition loaded through `profile-boot.ts`, `compatibility-runtime.ts`, `plugin.ts`, and `dump-config.ts`, and a Native composition loaded through `native-profile-loader.ts`. Every shipped profile name had both a Cordis template and a Native template, `profileRuntime` selected between them, and the CLI declared `@redspark/cordis` plus the Cordis Loader plugins as runtime dependencies. That split kept Cordis inside the application the CLI actually ships and made the Cordis removal a change to the launcher, the profile templates, the packed tests, and the recorded sessions at once.

The dynamic Cordis tool surfaces compounded the problem. `tool-cordis`, `cordis-host-runner`, `cordis-client-runner`, `ui-cordis`, and `code-runtime-worker-thread` exist to inspect, mount, and run code against the live Cordis runtime of the current process. They cannot survive the removal of that runtime, and they hold seven model-visible tools plus a Web scenario whose only purpose is exercising them.

## Decision

`bin.ts` loads only the Native runner. `readNativeProfile` is the single boot gate: a profile directory must declare `dsh.profile.runtime: "native"` and a `rsh.profile.json` composition, and a manifest that does not select Native execution is refused with a pointer to the migration reference. `--dump-config` uses the same gate.

The shipped names keep their identity but initialize as Native compositions: `headless` to `native-headless`, `web` to `native-web`, `sdk` to `native-sdk`, `acp` to `native-acp`, and `rsh` to `native-tui`. `--from-default-profile` copies any shipped Native template into a new custom name. The `native-*` templates remain explicit alternatives.

`dsh plugin` and `--dump-default-config` are removed. Profile packages are installed with the package manager into the profile directory, and the versioned `rsh.profile.json` records the installation rows; `--patch` remains the ordered, versioned JSON overlay.

The dynamic Cordis surfaces are retired rather than ported:

- `rsh/Modules/Official/extensions/tool-cordis` is deleted with its seven model-visible tools.
- `rsh/Modules/Official/extensions/cordis-host-runner` and `cordis-client-runner` are deleted; they mount plugins into the live Cordis runtime.
- `rsh/Modules/Official/extensions/ui-cordis` is deleted with the Web tool cards and slot projection.
- `rsh/Modules/Official/code-runtime/code-runtime-worker-thread` is deleted; `native-code-runtime` owns TypeScript worker execution.
- The Web Cordis tool scenario, its snapshots, and its scaffold option are deleted.
- The Python runtime smoke replays Native scenarios only; the retired `sdk-minimal` refusal checks use `--dump-config`.

`webworker-runtime` and `webworker-packer` stay. The Cordis-on-WebWorker composition has no Native equivalent: a browser WebWorker cannot host a Native Host runtime, and the browser preview is a private experiment rather than a Harness application launcher. `code-runtime-python` also stays because it is the only provider of Python code execution.

## Consequences

`rg '@redspark/cordis' rsh/Programs/CLI/src` is empty, and the CLI no longer reaches `rsh/Compatibility/DSH/boot/app-boot` at runtime. The Cordis compatibility bundles and their Desktop/Web consumers remain in the tree for the follow-up deletion, so `@redspark/cordis` and `cordis-plugin-loader` remain declared in the CLI manifest for the packed compat-bridge test. The launcher is therefore Native-only in behavior while the package still ships the Cordis payload until that follow-up lands.

Profiles created by older CLIs are not rewritten. They fail the Native gate and must be migrated with the documented JSON form; there is no fallback boot, no automatic conversion, and no downgrade path.

`verify-runtime-closure --target native-cli` and `verify-cordis-config` report pre-existing failures for optional-peer declarations and the `schedule`/`bundle-rsh` patches. Those failures are reproducible on the pre-change `main` tree and are not caused by this retirement; the follow-up Cordis deletion owns them.

## Alternatives considered

**Keep the Cordis boot path behind a flag.** It would preserve old profiles, but `@redspark/cordis` and the Loader plugins would stay in the CLI runtime closure, both boot paths would need tests and recorded sessions, and the Cordis deletion would still have to remove them. The flag buys one release of compatibility for a permanent second launcher.

**Port `tool-cordis` to Native.** The toolset exists to inspect and mutate the live Cordis composition. A Native equivalent would be a new capability with a different object model, not a port, and the inspect/mount/unmount surface has no consumer once Cordis profiles cannot boot.

**Keep `cordis-host-runner` as a Native sandbox.** Its `node:vm` realm is containment for honest code, not a security boundary, and mount code can reach the host realm. `native-code-runtime` already provides isolated TypeScript worker execution with the budgets and cancellation the product needs.

**Retire the WebWorker runtime with the rest.** The browser preview runs Cordis inside a WebWorker and has no Native host to connect to. Deleting it would remove a working experimental surface without replacing its capability.

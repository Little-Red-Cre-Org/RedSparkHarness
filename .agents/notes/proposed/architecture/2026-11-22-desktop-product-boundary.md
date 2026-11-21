# Agent Note: Desktop is the only independent product entry

Status: proposed

English | [中文](2026-11-22-desktop-product-boundary.zh.md)

## Problem

Desktop is the only official user entry and the official release (`pnpm run start:desktop`, `pnpm run package:desktop:*`). [Desktop-only retires the browser Web deployment](../../implemented/architecture/2026-11-21-desktop-only-retires-browser-web.md) already refuses `--profile web` and `--from-default-profile web`, and Desktop boots a Native profile only. The tree still contains historical and independent entries: Cordis Web bundles, `profile: web` snapshots, a TUI, other `dsh` profiles, SDK and ACP packages, and Typert Remote Web. Treating those entries as peer products, or deleting them before their preconditions are true, both misstate the repository.

Until this change, [Cordis cleanup keeps the legacy writers and three packages](2026-11-15-cordis-cleanup-keeps-legacy-writers.md) said the Desktop and Web holds stood. That sentence contradicted the shipped Native-only Desktop boot and the refused browser launch. This change aligns that note with the shipped behavior. Cleanup is not finished. This note does not start snapshot migration or entry retirement.

## Proposal

Record the current entries, what a later change may migrate or delete, and what this change must leave in place. Snapshot migration waits until this inventory and the other documentation changes opened with it have merged. Retiring independent entries is a later step after this inventory merges. This change edits documentation only.

### Sequencing

The count below is the migration input. It is not permission to edit `snapshots/`. The keep list is not a second product. An entry whose Desktop dependency is not proven stays, with deletion marked not yet verified.

### `profile: web` snapshots

The count unit is one `snapshot.yml`. On this tree, 32 files declare `profile: web`. That matches the planning count for `3e9c3bd`. Every match is under `snapshots/web/`. The 2026-11-15 measurement of 34 is not the current count.

- `snapshots/web/approval-composer/snapshot.yml`
- `snapshots/web/background-job-list/snapshot.yml`
- `snapshots/web/details-session-lifecycle/snapshot.yml`
- `snapshots/web/document-preview/snapshot.yml`
- `snapshots/web/feedback-command/snapshot.yml`
- `snapshots/web/feedback-release/snapshot.yml`
- `snapshots/web/file-upload-round/snapshot.yml`
- `snapshots/web/fresh-round-trip/snapshot.yml`
- `snapshots/web/goal-multi-turn-actions/snapshot.yml`
- `snapshots/web/lifecycle-chrome/snapshot.yml`
- `snapshots/web/live-interactions/snapshot.yml`
- `snapshots/web/message-actions/snapshot.yml`
- `snapshots/web/message-feedback-protocol/snapshot.yml`
- `snapshots/web/navigation-panes/snapshot.yml`
- `snapshots/web/open-in-app-ssh/snapshot.yml`
- `snapshots/web/permission-policy-context/snapshot.yml`
- `snapshots/web/plan-narrow-viewport/snapshot.yml`
- `snapshots/web/plan-review/snapshot.yml`
- `snapshots/web/present-svg/snapshot.yml`
- `snapshots/web/preset-migration/snapshot.yml`
- `snapshots/web/pwsh-terminal/snapshot.yml`
- `snapshots/web/question-composer/snapshot.yml`
- `snapshots/web/queue-actions/snapshot.yml`
- `snapshots/web/queued-image/snapshot.yml`
- `snapshots/web/seeded-history/snapshot.yml`
- `snapshots/web/sidebar-scrollbar/snapshot.yml`
- `snapshots/web/steering/snapshot.yml`
- `snapshots/web/subagent-conversation/snapshot.yml`
- `snapshots/web/subagent-interrupt/snapshot.yml`
- `snapshots/web/turn-tail-actions/snapshot.yml`
- `snapshots/web/web-search-round/snapshot.yml`
- `snapshots/web/workspace-management/snapshot.yml`

`snapshots/web/` has 45 scenario directories. These 13 `snapshot.yml` files do not declare `profile: web`. Each declares `profile: native-web`. They are not part of the 32, and this inventory does not schedule them for a `profile: web` migration.

- `snapshots/web/bash-abort-row/snapshot.yml` — `native-web`
- `snapshots/web/minimal-preset/snapshot.yml` — `native-web`
- `snapshots/web/native-conversation/snapshot.yml` — `native-web`
- `snapshots/web/native-feedback/snapshot.yml` — `native-web`
- `snapshots/web/native-github-webhook/snapshot.yml` — `native-web`
- `snapshots/web/native-question-cancel/snapshot.yml` — `native-web`
- `snapshots/web/native-session-core/snapshot.yml` — `native-web`
- `snapshots/web/native-session-grant/snapshot.yml` — `native-web`
- `snapshots/web/present/snapshot.yml` — `native-web`
- `snapshots/web/ptc-round/snapshot.yml` — `native-web`
- `snapshots/web/schedule-catalog/snapshot.yml` — `native-web`
- `snapshots/web/skill-tool-row/snapshot.yml` — `native-web`
- `snapshots/web/workflow-run/snapshot.yml` — `native-web`

`snapshots/desktop/native-session-core/snapshot.yml` declares `profile: desktop`. It stays with Desktop. Later snapshot work does not reclassify it as a browser scenario.

Later action: migrate or explicitly retire each of the 32 files in a separate change. Preconditions: this inventory and the other documentation changes opened with it have merged, and the Native gaps recorded in the Desktop-only note are either implemented or called out per scenario. Owner: the snapshot scenarios, not the Desktop shell. Blocker: several scenarios still exercise the Cordis browser composition. Keep reason: deleting the files, or flipping `profile:` in this change, drops coverage before that batch.

### Browser Web leftovers

Supported browser launch is already refused. `rsh/Programs/CLI/src/args.ts` rejects `--profile web` and `--from-default-profile web` with a pointer to `rsh/Docs/native-config-migration.md`. A positional `web` argument is not a profile: `parseRshArgs` requires `--profile` and exits before boot. There is no `web` subcommand. `dsh.nativeProfileTemplates` in `rsh/Programs/CLI/package.json` does not list `web`.

`demo:inspector` in the root `package.json` still runs `rsh/Programs/CLI/src/bin.ts web` with a patch under `rsh/Modules/Community/experimental/inspector`. That invocation does not pass `--profile`, so the current parser rejects it. Later action: delete or retarget the script when the inspector package's tests no longer need a browser host. Preconditions: no supported workflow documents `demo:inspector` as a product entry. Owner: the root script and `@redspark/rsh-experimental-inspector`. Blocker: the inspector package still has its own tests, which [the 2026-11-15 cleanup note](2026-11-15-cordis-cleanup-keeps-legacy-writers.md) keeps. Keep reason: removing the package is a Cordis-cleanup decision, not a README correction.

`pnpm run dev:web` runs `rsh/Scripts/dev-web.ts`. The script rebuilds browser artifacts. Its comments still say `dsh web` serves them. Later action: retarget or delete the script with the browser lane. Preconditions: no test or contributor workflow still needs that watch loop. Owner: the root script. Blocker: `rsh/Programs/Web/application/tests/hmr-live.e2e.ts` waits on `pnpm run dev:web`. Keep reason: the script is still a callable development command, and this change does not edit tests.

`@redspark/rsh-web-app` (`rsh/Compatibility/DSH/bundle/web-app`), `@redspark/rsh-base` (`rsh/Compatibility/DSH/bundle/base`), and `@redspark/rsh-web-compatibility` (`rsh/Compatibility/DSH/web/frontend`) are public packages. `@redspark/rsh-host-webserver` (`rsh/Programs/Web/host/webserver`) and `@redspark/rsh-host-frontend-static` (`rsh/Programs/Web/host/frontend-static`) are public and are how the Cordis browser bundle serves a page. The same `rsh/Compatibility/DSH/bundle/` directory still publishes `@redspark/rsh-headless`, `@redspark/rsh-rsh`, `@redspark/rsh-sdk-app`, `@redspark/rsh-acp-app`, and `@redspark/rsh-sdk-minimal`. Later action: delete these Cordis application bundles with the browser lane. Preconditions: no snapshot, test, or Desktop package manifest still loads them. Owner: `rsh/Compatibility/DSH`. Blocker: `rsh/Programs/Web/application/tests/scaffold.ts`, `assembled-boot.ts`, and `schedule-after.e2e.ts` still load `rsh/Compatibility/DSH/bundle/web-app/cordis.patch.yml`. `smoke-real.e2e.ts` passes a positional `web` argument to `rsh/Programs/CLI/src/bin.ts`, and `hmr-live.e2e.ts` passes that argument to `rsh/Programs/CLI/lib/bin.js` and waits on `pnpm run dev:web`. `parseRshArgs` rejects the argument before boot. `@redspark/rsh-desktop` and `@redspark/rsh-desktop-host` do not name `@redspark/rsh-web-app` in their own dependency lists. Keep reason: the scaffold and the 32 snapshots still name that Cordis composition. Deleting the bundles here would claim a retirement that has not happened.

### TUI

`rsh/Programs/TUI/native-tui` (`@redspark/rsh-native-tui`) and `rsh/Programs/TUI/terminal-ui` (`@redspark/rsh-terminal-ui`) are public. `rsh/Programs/CLI/src/native-profile-template.ts` maps the shipped name `rsh` to `native-tui`. Help text still shows `dsh --profile rsh`. `@redspark/rsh` depends on `@redspark/rsh-native-tui`. Later action: retire `rsh` / `native-tui` as an independent user entry. Preconditions: the CLI manifest no longer needs the package for a profile Desktop does not load, or a measured Desktop boot shows the dependency is unused. Owner: `rsh/Programs/TUI`, not the Desktop shell. Blocker: the dependency from `@redspark/rsh` is declared; whether the Desktop Host process loads the TUI plugin is not yet verified. Keep reason: do not delete the source in this change, and do not describe the TUI as a current official product entry or as a long-term peer product.

### CLI profiles

`dsh.nativeProfileTemplates` in `rsh/Programs/CLI/package.json` lists 12 names: `headless`, `sdk`, `acp`, `rsh`, `native-headless`, `native-sdk`, `native-sdk-dsh-child`, `native-web`, `native-acp`, `native-acp-dsh-child`, `native-tui`, and `native-headless-query`. Aliases live in `STANDARD_PROFILE_COMPOSITIONS` in `rsh/Programs/CLI/src/native-profile-template.ts`. [CLI boots only Native profiles](../../implemented/architecture/2026-11-19-cli-native-only-boot-and-legacy-retirement.md) is the boot rule. Coding-tool packages are out of this retirement: `@redspark/rsh-hooks-codex`, `@redspark/rsh-codex-app-server`, and `@redspark/rsh-subagent-codex`. This tree has no Antigravity package or directory. `prepare:dsh` (`rsh/Programs/Desktop/scripts/prepare-dsh.ts`, script on `@redspark/rsh-desktop`) materializes the production runtime before Desktop packaging and stays.

| Name | Class | Current behavior | Later action |
|---|---|---|---|
| `headless`, `native-headless` | Keep as the test and developer launcher | `headless` aliases to `native-headless`. Help text and root `AGENTS.md` offer it. 83 snapshots declare `profile: headless` and 21 declare `profile: native-headless`. `@redspark/rsh` depends on `@redspark/rsh-native-headless`. | Keep the test entry. It is not an official Desktop peer product. |
| `native-headless-query` | Keep with headless | Shipped template with the SQLite session-query rows. `snapshots/native-headless-query/session-query/snapshot.yml` declares it. | Keep until the headless test tool's owner decides otherwise. |
| `native-web` | Keep | Shipped template for the desktop renderer. Loopback inspection via `pnpm dsh --profile native-web`. Desktop fresh profiles request this client template. | Keep. Not an independent browser product. |
| `rsh`, `native-tui` | Independent user entry | Alias and public TUI packages, as in the TUI section. | Retire the user entry later. Do not delete the packages yet. |
| `sdk`, `native-sdk` | Independent launch; deletion not yet verified | `sdk` aliases to `native-sdk`. The SDK client native entry fixes that profile and resolves `dsh`. | Do not delete. Not a long-term peer product. |
| `native-sdk-dsh-child` | CLI-private child launcher | Not a help-text user name. CLI tests and the SDK child path boot it. | Keep while SDK child execution remains. |
| `acp`, `native-acp` | Independent launch; deletion not yet verified | `acp` aliases to `native-acp`. | Do not delete. Not a long-term peer product. |
| `native-acp-dsh-child` | CLI-private child launcher | `rsh/Programs/CLI/src/native-acp-child-runtime-launcher.ts` passes this profile. | Keep while ACP child execution remains. |
| `web` | Retired launch name | Absent from the template list. `args.ts` rejects it. | Do not restore. |
| `sdk-minimal` | Retired launch name | `args.ts` rejects it. `@redspark/rsh-sdk-minimal` still publishes. | Delete the bundle with the other Cordis bundles, not here. |

### Remote and Typert

Typert Remote Web retires with Cordis. [Typert retires with Cordis](2026-11-17-typert-retires-with-cordis.md) owns the deletion list: `rsh/Core/typert/generator`, `rsh/Core/typert/loader`, `rsh/Core/typert/protocol`, `rsh/Core/typert/registry`, `rsh/Programs/Web/api/gateway` (`@redspark/rsh-api-gateway`), and `rsh/Programs/Web/api/remotes` (`@redspark/rsh-api-remotes`). Those directories are still present. Later action: delete them in the Cordis package-removal phase named there, not in this change. Preconditions: that note's acceptance criteria. Owner: Typert and the legacy Web controllers. Blocker: production classes still extend `TypertRemoteService`, including `rsh/Programs/Web/host/plugin-inventory/src/index.ts`. Keep reason: deleting the generator or gateway before the Native owners are the only callers leaves generated clients with nothing to call.

Do not delete the Native Connection registry or the native-web host transport. `@redspark/rsh-client-connection` exports `./native-host` from `rsh/Programs/Web/client/connection`. `@redspark/rsh-native-web-host` (`rsh/Programs/Web/host/native-web-host`) and `@redspark/rsh-native-web-assets` serve the Desktop renderer. They stay with the Desktop chain.

### npm publish and Desktop packaging

`rsh/Scripts/verify-publish-payload.ts` does not keep a fixed package allowlist. It packs every non-private workspace package whose `exports` object contains `./native`, then checks that bare specifiers in the tarball resolve from an installing dependency section. On this tree that selection is 209 packages. `@redspark/rsh-desktop` and `@redspark/rsh-desktop-host` are `private: true`, so this check does not pack them.

`pnpm run release:publish` runs `rsh/Scripts/release/publish.ts`, which publishes one packed family. `rsh/Scripts/release/families.ts` defines `dsh` and `vendor`. A `dsh` member is a non-private manifest matched by `RELEASE_MANIFEST_GLOBS`, `rsh/Programs/*/package.json`, `rsh/Programs/Web/application/package.json`, or `PUBLIC_EXPERIMENTAL_PACKAGE_DIRECTORIES` in `rsh/Scripts/experimental-package-policy.ts` (Agent Teams only). The installed entry is `@redspark/rsh` at `lib/bin.js`. The vendor family is `rsh/Core/vendor/*` and is not the Desktop product. Public independent entries that this family still ships include `@redspark/rsh`, `@redspark/rsh-native-tui`, `@redspark/rsh-terminal-ui`, `@redspark/rsh-sdk-client`, `@redspark/rsh-native-sdk-server`, `@redspark/rsh-sdk-jsonrpc-server`, `@redspark/rsh-acp`, `@redspark/rsh-native-acp`, `@redspark/rsh-web-app`, `@redspark/rsh-base`, and `@redspark/rsh-web-compatibility`. `@redspark/rsh-web-frontend` is public because the desktop renderer build consumes it; it is not a second product.

Desktop packaging stays. Root scripts `start:desktop` and `package:desktop:*` delegate to `@redspark/rsh-desktop`. `rsh/Programs/Desktop/src/core-package-set.ts` puts `@redspark/rsh` and `@redspark/rsh-desktop-host` in `RELEASE_PACKAGES`, requires `assembly: native`, and lists `@redspark/cordis` in `CORDIS_RUNTIME_PACKAGES` as the plugin kernel. The same file says loader and bundle packages stay excluded from that kernel list. Later action: none in this change. Do not drop `@redspark/rsh` from the Desktop package set in order to hide the public CLI.

### Desktop chain that stays

These are not deletion candidates:

- Web client source under `rsh/Programs/Web/client/**`, including the Native boot in `rsh/Programs/Web/client/web`.
- The `native-web` profile template in `rsh/Programs/CLI/src/native-profile-template.ts`.
- `@redspark/rsh-native-web-assets` at `rsh/Programs/Web/host/native-web-assets`.
- `@redspark/rsh-native-web-host` at `rsh/Programs/Web/host/native-web-host`.
- `@redspark/rsh-native-web-session-controller` at `rsh/Programs/Web/api/native-web-session-controller`.
- `@redspark/rsh-desktop-host` at `rsh/Programs/DesktopHost`, and the Engine tree under `rsh/Engine` that the bundled runtime loads.
- Native API controllers the Desktop host calls. This keep does not include `rsh/Programs/Web/api/gateway` or `rsh/Programs/Web/api/remotes`.
- `prepare:dsh` at `rsh/Programs/Desktop/scripts/prepare-dsh.ts`.

`@redspark/rsh-desktop` is private and is the Electron shell. It is the product package, not an npm product entry.

### SDK, ACP, and headless

SDK and ACP are independent launch entries today: `dsh --profile sdk` and `dsh --profile acp`, with public packages under `rsh/Programs/SDK/packages/` and `rsh/Programs/ACP/packages/`. `@redspark/rsh-desktop` does not depend on those package names. `@redspark/rsh-desktop-host` depends on `@redspark/rsh`, and that manifest depends on `@redspark/rsh-native-sdk-server`, `@redspark/rsh-sdk-protocol`, `@redspark/rsh-sdk-runtime`, `@redspark/rsh-sdk-child`, `@redspark/rsh-native-acp`, `@redspark/rsh-acp-protocol`, `@redspark/rsh-acp-child`, `@redspark/rsh-native-tui`, and `@redspark/rsh-native-headless`. Whether the Desktop Host process loads the SDK, ACP, or TUI plugins is not yet verified. Later action: decide product retirement only after that load is proven unused or the CLI dependency is split. Do not delete the packages. Do not write SDK, ACP, or headless as long-term peer products.

Headless is the test and developer launcher (`pnpm dsh --profile headless` in root `AGENTS.md`, plus the snapshot counts above). Keep that entry even though help text also presents it to users. `rsh/Programs/SDK/python/sdk-runtime` (`dsh-python-runtime-closure`) is `private: true` and still names Cordis packages; the 2026-11-15 note keeps that closure. This inventory does not remeasure it.

### Historical records

Do not delete history to make the product sentence look cleaner. Archived Agent Notes under `.agents/notes/archived/` stay frozen ([archive policy](../../implemented/process/2026-07-26-frozen-agent-note-archive.md)). Git history stays. The README citation keeps the upstream title and the paper URL. Upstream copyright and license text in `LICENSING.md` and `THIRD_PARTY_NOTICES.md` stays. Monorepo history documents stay until a change owns the fact they still need.

### Documentation left in place

This change does not rewrite standing architecture docs. These contradictions remain on purpose:

- Root `AGENTS.md` still describes an all-plugin Cordis harness and documents `pnpm dsh --profile headless`.
- `rsh/Docs/architecture.md` lists `dsh --profile native-web`, `headless`, `sdk`, and `acp` as the shipped applications. Its Desktop section describes the Electron application separately.
- `rsh/Programs/Web/host/native-web-assets/README.md` still mentions compatibility-mode previews.
- `rsh/Scripts/dev-web.ts` comments still name `dsh web` as the server that reload-watches built artifacts.

## Alternatives considered

**Delete the leftover packages and snapshots in this change.** Rejected. The 32 `profile: web` scenarios and the Web application tests still name the Cordis browser composition. The Desktop-only note already records why deleting that composition first drops coverage. SDK, ACP, and TUI deletion is not yet verified against the `@redspark/rsh` dependency that Desktop Host installs.

**Keep the TUI, Web, SDK, and Desktop as peer products.** Rejected. The official release is Desktop. Entries that remain in the tree are historical or independent, not a second supported product line. Unproven dependencies stay as not yet verified, which is not the same as adopting them as permanent products.

**Archive or reject the 2026-11-15 cleanup note.** Rejected. Cordis cleanup is unfinished, so that note stays proposed. This inventory is a partial supersession: both notes stay, and each links the other. The Desktop-only note stays implemented because it records the shipped Native assembly and the launch refusal.

**Rewrite `rsh/Docs/architecture.md` and root `AGENTS.md` here.** Rejected. Those files are the architecture map and the standing orders. The contradictory product sentences are listed above so a later doc change can own them. This change does not edit those files.

## Acceptance criteria

- The 32 `profile: web` paths and the 13 `snapshots/web/` paths that declare `native-web` are listed here, and the count matches a fresh enumeration on this tree.
- README states that Desktop is the only official user entry, that `native-web` is development and inspection, and that TUI, other CLI profiles, SDK, ACP, and leftover Web and Remote code remain in the tree without being current official product entries.
- README clone and repository links use `https://github.com/Little-Red-Cre-Org/RedSparkHarness`.
- The 2026-11-15 note states that the Desktop compatibility assembly and the supported browser launch are gone.
- No package, snapshot, test, or workflow file is deleted or renamed by this change.

## Risks

A later change can read "retire" and delete `native-web`, the Web client, `prepare:dsh`, or `@redspark/rsh-native-web-assets`. Those rows are keep rows. The word retire applies only to independent user entries whose preconditions are met.

Snapshot migration can start before this documentation batch has merged and can retarget a scenario that the Native client does not yet cover. The Desktop-only note owns those gaps. This inventory does not reopen them.

SDK, ACP, or the TUI can be deleted because their user entry is not the official product, while `@redspark/rsh` still depends on their packages and Desktop Host still depends on `@redspark/rsh`. That load is not yet verified. Deleting from the product sentence alone is the failure this note is here to prevent.

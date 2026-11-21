# Agent Note: Desktop-only retires the browser Web deployment

Status: implemented

English | [中文](2026-11-21-desktop-only-retires-browser-web.zh.md)

## Problem

Desktop supported two assemblies: the default Native Host and a compatibility Host that booted Cordis bundles. The CLI also exposed a `web` command and a shipped `web` profile for a standalone browser deployment. Keeping both product paths meant every Desktop change had to preserve a Cordis boot glue package, a legacy plugin manager, and a browser launch surface that no supported user flow needed. That compatibility branch is the main reason Cordis cannot be removed from the product.

## Decision

Desktop ships one Native assembly. `desktop-host-compatibility` is deleted, `packages/prepare-package-set.ts` and `package-target.ts` reject `--assembly` values other than `native`, `RSH_DESKTOP_ASSEMBLY` rejects non-Native values, and an existing runtime descriptor with `assembly: compatibility` fails with a pointer to `rsh/Docs/native-config-migration.md`. `DesktopHost` refuses a non-Native profile with the same migration pointer instead of importing a compatibility runtime.

The Desktop project manager keeps only Native module management. Legacy plugin list, add, update, remove, disable-all, `supportsLegacyPluginManagement`, and profile-bundle writes are removed; a non-Native profile throws the retired-profile error, reset always creates a Native profile, and fresh composition requests the `native-web` client template.

The CLI retires the `web` command alias and refuses `--profile web` and `--from-default-profile web`. Its native profile templates list only `native-web`. CLI tests that booted the retired entry are deleted; Native Web boot and authorization coverage lives in the Web application e2e suite and the Native session-controller authorization tests. The GitHub webhook real-HTTP end-to-end case has no replacement because it drove the retired server; the webhook handler and composition suites remain.

The browser renderer and its supporting Native host packages remain: `rsh/Programs/Web/client/**`, the Native boot entry under `client/web`, `host/native-web-assets`, `host/native-web-session-controller`, the `native-web` profile, `rsh-web-frontend`'s built assets, and the compatibility bundles plus `profile: web` snapshots used by the existing browser e2e lane. Deleting those requires the follow-up legacy Web retirement, because the snapshots still boot that composition and the remaining Native UI gaps (skill tool row, settings document, right-sidebar tabs) block moving them first. Native Host subagent conversation, catalog, interrupt, and session fork are served by [Native Host subagent and fork](../feature/2026-11-22-native-host-subagent-and-fork.md).

`tsconfig.host.json` references the Web frontend project because `verify-publish-payload` reads `PLATFORM_MODULES` and `PRELOADED_CLIENT_EXTERNALS`; the reference resolves those values to declarations without adding client sources to the host program.

## Alternatives considered

**Delete every Web package in this change:** the retained `profile: web` snapshots and the compatibility bundle chain still boot `rsh-web-compatibility`, `host-webserver`, and `host/frontend-static`. Deleting them now would remove coverage before the Native replacements exist.

**Keep the compatibility assembly hidden behind a flag:** a hidden fallback keeps the Cordis boot glue and plugin manager alive, and users would get two different Desktop runtimes from one release.

**Migrate the Web snapshots to Native now:** the remaining Native UI gaps would silently lose coverage for the skill tool row, settings documents, and multi-document sidebar tabs.

**Make Desktop accept a custom Cordis profile with a warning:** silent acceptance preserves the legacy profile format and blocks every later Cordis deletion. The migration error names the supported replacement.

## Consequences

Legacy Desktop profiles now fail loudly with a migration pointer instead of starting a compatibility Host. The legacy plugin window, recovery action, preload bridge, and IPC handlers are gone; Native module management is the only package surface. Desktop packaging always produces the Native target layout and always ships `@redspark/rsh` plus `@redspark/rsh-desktop-host`.

The standalone browser deployment has no supported launch path, but its Cordis bundles, server packages, and snapshots remain for the browser e2e lane. The next change must retire that lane, migrate or document each of the 32 `profile: web` scenarios, and remove `rsh-web-app`, `rsh-base`, the Typert remote Web surface, and the remaining Cordis Web entry points.

The remaining Native gaps are product gaps, not hidden fallbacks: the skill tool row, the settings document UI, and right-sidebar multi-document tabs. Native Host subagent conversation, catalog, interrupt, and session fork are served. Until the skill tool row, settings document UI, and right-sidebar multi-document tabs exist, the snapshots that exercise them stay on the legacy composition.

## Verification

`pnpm run typecheck`, `pnpm run lint`, and `pnpm run doc-sync` pass. Fifteen focused Vitest files pass — 177 tests, one skipped — covering Native package selection, retired assembly rejection, Native profile linking, startup copy, the retired CLI aliases, and the package-set, runtime-closure, and build-output gates. Native project-manager tests that shared a describe block with the deleted legacy plugin suite were restored with `setupNative()`. `pnpm run test` reports 175 failures against 183 on the pristine `ad37307b34` baseline; a name-level comparison of both runs shows no test that this change touches, and the failure set is otherwise unchanged. Desktop packaging preparation cannot run on this Linux host (`unsupported build host linux-x64`), so the packaged smoke is left to CI.

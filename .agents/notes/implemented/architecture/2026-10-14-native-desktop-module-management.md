# Agent Note: Native Desktop module management

Status: implemented

English | [中文](2026-10-14-native-desktop-module-management.zh.md)

## Problem

Native Desktop profiles select packages for scoped Host composition and Client boot. Those rows need package and activation controls without sharing Cordis plugin semantics or allowing a second writer to alter the Electron-owned profile.

## Decision

`DesktopProjectManager` remains the only writer of the reserved profile and package state. `dshDesktop.plugins.native` uses the shell-owned plugin window, existing authenticated plugin IPC channels, the existing package transaction lock, bundled pnpm, pending marker, shared-package links, and Host restart hooks. The renderer submits exact package versions and explicit Host or Client installation rows; it cannot submit filesystem paths, package-manager arguments, or raw configuration to inventory reads.

Inventory returns opaque installation ids, saved Host scopes, package ownership and capabilities, `hasConfig`, and a revision of the profile inputs. Every mutation sends that revision. The manager compares it under the existing lock before stopping the Host; lock contention returns `busy`, and a stale revision returns the current revision without changing profile files.

Host rows retain their scope and Client rows retain their configuration when toggled. Client formatVersion 1 accepts optional `disabled`; disabled rows stay saved but are excluded from the compiled modules and boot selections. `disableAll` preserves the Desktop Host requirements and the validated nearest required-provider closure, while signed-runtime packages remain selectable but cannot be physically updated or removed.

Host composition preflight imports selected Host entries and any conditional CLI child-support rows in a fresh worker, so a package update cannot reuse ESM modules loaded from the prior version. The worker uses the CLI profile loader's root launch-environment and `pluginInventory` Providers, scope-local SDK or ACP child-runtime launchers, missing subprocess or sandbox support rows for enabled child modules, and the private Desktop carrier before resolving the Host graph; it does not activate Providers. Inventory expands preset metadata and computes required retention without deriving routes for active child rows. Enable/disable candidates and changed mutations still derive and validate routes through the CLI loader, so malformed optional child configuration remains visible and can be disabled while malformed retained configuration blocks a change before the Host stops. Preset-derived scopes, installations, and configuration participate in dependency checks without rewriting saved installation rows. `disableAll` retains the Desktop boot's required-provider closure. If that closure retains a preset manager or generated preset row, it also retains that manager's active generated rows and their required Providers; otherwise, an optional preset manager and its Providers can be disabled together. Client preflight reads selected manifests and creates a browser-targeted bundle without importing Client entries into the Electron main process. Selected optional dependencies participate in ordering and cycle validation, while required dependencies alone determine `disableAll` retention.

Package changes modify the current profile directly. Before stopping the Host, the manager keeps the original bytes of `rsh.profile.json` and `rsh.client.json`, plus `package.json` and `pnpm-lock.yaml` for package operations. After any failure following the Host handoff, it restores those bytes, reinstalls the restored locked dependency graph through the pending marker for package operations, and restarts the previous Host. A restored mutation is refused with its original error code; only a failed restoration or restart reports `recovery-required`. The pending marker still means only that package preparation is unfinished. Application quit waits for an in-flight Native mutation, including restoration, before closing the Host, and refuses mutations requested after quit begins. `applied` means the Host is ready and the Client bundle was generated. Browser activation and mount errors remain GUI acceptance because no browser health result reaches the manager. Native startup retry stays hidden until its conditions have a defined backend owner.

## Alternatives considered

**Add a second package manager or state store:** this would create another writer beside the Desktop lock, direct dependencies, lockfile, and recovery marker.

**Move Client disabled state to a new profile format version:** an optional boolean preserves existing formatVersion 1 rows and leaves absent `disabled` enabled by default.

**Stage profile copies or keep direct writes without restoration:** staging copies would add another recovery state beside the pending marker, while leaving a failed composition in place would break the requirement that the previous composition still starts. In-memory bytes of the few files a mutation changes, plus the existing locked reinstall, restore that composition without new on-disk state.

## Consequences

The Native module window can manage package versions and Host or Client installation rows while legacy Cordis plugin operations remain separate. Errors expose stable codes, locale message keys, truthful backend phase and recovery state without configuration values, filesystem paths, or package-manager output. Changes to Client boot defaults remain owned by the [Native Client preview decision](2026-09-24-desktop-native-client-preview.md), and compatibility plugin failure behavior follows the [Desktop profile decision](2026-09-09-desktop-in-place-profile.md).

Focused manager tests cover required-row retention through the CLI `pluginInventory` Provider, child-route enablement and missing-model refusal before Host stop, saved child configuration, preset-derived dependency retention without writing generated rows, stale and busy requests, exact package changes, partial package recovery, other injected Host Providers, a browser-only Client entry, optional dependency cycles, and an updated Host entry. IPC tests cover the packaged management-window entry. Client bundle tests cover disabled-row preservation and omission from active selections. Browser activation still requires packaged GUI acceptance.

The lifecycle cases also assert that stale, busy, retained-row, and fresh-worker preflight refusals leave both profile files byte-identical without stopping the Host; that profile writes and the package pending marker wait for the held Host stop; that a Host stop failure writes nothing and starts no replacement; that `applied` waits for the replacement Host; that a start failure restores the original profile bytes, restarts the previous Host, and refuses with `host-start-failed`; that a failed restart returns `recovery-required`; and that a failed package operation restores `package.json` and `pnpm-lock.yaml`. Quit cases assert that Host shutdown waits for an in-flight mutation and that later mutations are refused as `busy`. Removal evidence covers saved configuration and the generated Client bundle, not mounted contribution withdrawal.

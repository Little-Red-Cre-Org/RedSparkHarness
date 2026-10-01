# Agent Note: Native Client installation replacement

Status: implemented

English | [中文](2026-10-01-native-client-installation-replacement.zh.md)

## Problem

The native Client boot kernel exposes startup and stop only. Recreating it after configuration changes discards unchanged renderer and transport owners, while replacing module selections without a complete plan can leave mounted React roots using disposed services.

## Decision

`NativeClientHost.replace({ modules, selections })` serializes complete Client graph preparation and delegates resolved plans to `NativeHost.replace()`. The boot lifetime retains one scope and mount request. Selection ids retain their request only when the exported plugin identity and configuration remain equal; `dequal` supplies portable structural comparison without importing Node utilities or owning a second equality implementation. Dependency changes still reactivate affected consumers through the shared runtime.

The mount request consumes the selected application and renderer. Replacement releases that consumer before changed Providers, so a React root unmounts before its application unregisters slots and before a successor claims the container. Unchanged renderer and SlotRuntime instances remain active. Import or resolution refusal preserves the current UI; cleanup or activation failure closes the Host without restoring disposed services. `host.signal` exposes whole-composition cancellation.

`stop()` closes preparation admission immediately and waits for already admitted imports and runtime cleanup to settle, even when cleanup fails. Imports that settle after cancellation cannot activate a successor. Concurrent replacements prepare against the last committed request map. The browser entry forwards the same operation and owns its initial styles until stop.

## Alternatives considered

**Reboot the entire Client after any change:** Rejected because unchanged Provider identities and state would be discarded.

**Compare configurations by JSON text:** Rejected because property order can change without changing the configuration. The portable Client uses the installed maintained equality dependency.

## Consequences

The Client kernel can replace both configuration and explicitly supplied module exports. Native Web Host live mode now watches the profile directory, publishes a versioned wire through an authenticated Connection Fetch route, and updates the asset map only after a complete candidate bundle succeeds. The browser loads candidate styles and imports before committing replacement; a failed candidate leaves the current UI and its styles. The boot scope remains a single root; source-level module HMR, arbitrary legacy plugin reload, and full Client migration remain outside this decision.

## Verification

Six real React and SlotRuntime cases cover no-op identity preservation, changed application configuration, import and configuration refusal, stop during a blocked import, competing plans, changed module exports, and fatal successor activation. Host HTTP and configuration suites cover authenticated route ownership and live mode validation; the existing boot and browser entry suites verify renderer acquisition, injected-data validation and stylesheet cleanup. The packed native consumer typechecks replacement, cancellation and stop against published declarations without Cordis.

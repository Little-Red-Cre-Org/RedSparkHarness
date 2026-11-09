# Agent Note: Native Sessions record their standing permission facts

Status: implemented

English | [中文](2026-11-09-native-permission-seeding.zh.md)

## Problem

A Cordis Session reaches its model with three durable permission facts already in its log: `permission/preset`, `sandbox/mode`, and `approval/policy`. `PermissionPresetService` writes them in `pinInitialPermission` on `session/created`, before the Session is published.

A Native Session logged none of them. `native-sandbox-policy` and `native-approval` enforced a resolved policy, and `native-permission-presets` could write all three through `apply()`, but only when a user selected a preset. A session nobody reconfigured carried no record of the policy that governed it: replay could not reconstruct the mode, and a comparison against a Cordis recording diverged on the session's first three events.

## Decision

The Native permission-presets Provider seeds the missing facts when its exact owner attaches. `activeSessions.onAttached` gives the Provider the writer before initial model admission and behind `context.effect`, so the observer is removed with the Provider. The observer reads durable history once, and appends only what is absent:

- `sandbox/mode` from `sandboxPolicy.resolve({ session })`, the same resolution the enforcing tools use
- `approval/policy` from the installed `approval` policy
- `permission/preset` from the preset that the logged pair actually matches

A session that already logged all three is untouched, a partially initialized session gains only its gaps, and a pair matching no preset stays `custom` rather than inventing a name. A `WeakSet` of seeded owners keeps one attach from seeding twice.

## Alternatives considered

**Write the facts in `native-headless` instead.** Rejected. The application owns the turn, not the permission vocabulary; the Cordis owner is the permission Preset service, and a second writer in the application would duplicate the preset table and drift from it.

**Seed from `sandboxPolicy` and `approval` independently.** Rejected. Those Providers enforce a policy but own no preset name, so `permission/preset` would have no author. Seeding from the preset owner keeps one writer for the trio, exactly as Cordis does.

**Append on every attach.** Rejected. A resumed Session already carries the facts; appending again would log a second copy per attach and break the replay equality this exists to restore.

## Consequences

A Native Session now records the policy that governs it, and its event sequence matches a Cordis recording from the first event. On the `fs-read` migration probe the produced sequence went from 18 events differing at the head to all 21 events identical.

The seed is a projection of the composed policy, not user intent: it records what the deployment already decided, and a later preset selection still replaces it through `apply()`. A deployment that installs neither `sandboxPolicy` nor `approval` cannot compose this Provider, which already requires both.

Verification: `tests/native.spec.ts` seeds a fresh Session, leaves a fully-logged Session untouched, and fills only the gaps of a partially initialized one. Removing the seeding guard fails the first and third cases.

# Agent Note: Transitional native source dependency gate

Status: implemented

English | [中文](2026-09-23-transitional-native-source-gate.zh.md)

## Problem

The strict Cordis-free source and manifest gate covered the P1 Core roster, but new P4 native Engine and Module packages were outside its source scan while they still retained mandatory Cordis peers under the pre-stable workspace policy. A direct source import, type reference, re-export or dynamic load of Cordis or a Program package could therefore enter a native package without an executed check.

## Decision

Maintain a separate, explicit P4 source-owner roster in `native-package-policy.ts`. The executed `verify-native-dependencies` gate checks every production TypeScript source in both compiler faces and rejects computed or unresolved module targets, resolved Cordis or compatibility targets, Program targets, and Core source edges into higher layers. It resolves aliases and relative paths to physical targets rather than relying on the import spelling. Every Core, Engine or Module package declaring a native entry must be in the strict roster, the transitional source roster or a named mixed-package exception. For mixed packages, the gate starts at the declared `./native` source and follows relative and same-package exports, including type-only references, without scanning unrelated legacy source. The strict P1 roster retains its existing source and manifest closure checks.

Mixed libraries with a native export but no installer manifest use a separate explicit roster. The gate validates the export declaration path and checks its reachable source in each declared compiler face. This admits native credential definitions while keeping their Cordis service and event declarations on the legacy entry.

The transitional gate does not treat a source-only pass as a Cordis-free package claim. P4 packages still carry Cordis peers, and some depend on legacy Engine Definitions whose production closures remain coupled. P5 must remove those edges, classify required peers and dependencies precisely, and verify declarations, packages and independent consumers before expanding the strict roster.

## Alternatives considered

**Put every P4 package in the strict roster now:** The existing mandatory Cordis peers would make the gate fail before the planned manifest and distribution migration, obscuring direct source regressions that can already be rejected.

**Search source text for `cordis`:** Text matching misses aliases, relative imports, re-exports, module augmentations and type-only references, while flagging comments and harmless data.

**Permit unresolved imports until P5:** An unresolved workspace target can conceal a forbidden dependency, so the source check refuses it immediately.

## Consequences

Adding a native package requires placing its source owner in the transitional roster while P4 is underway. Native subentries in `fs-local`, `fs-observation-policy` and `session-persistence-jsonl` remain named mixed-package exceptions: the package-wide roster cannot describe their Cordis and native source trees. The gate checks each mixed native entry's own source closure, including transitive type references and aliases. The final cross-package artifact and manifest closure remains an explicit P5 requirement.

The `credentials` and `launch-environment` packages use the mixed-library roster because their `./native` exports supply values and types rather than installers. Credential key constructors and data types are shared with the legacy service; Cordis event declarations remain in the legacy `./types` export. The launch snapshot and SSH query are shared with the legacy context adapter, while `launchEnvironmentOf(ctx)` stays on the root export. A native credential Provider is still required for an operational profile.

## Verification

The executed verifier passes on the current P4 worktree. Negative fixtures reject Cordis and Program aliases, type-only references, computed and unresolved loads, Core-to-Engine imports, an unclassified native-entry package, and mixed entries that reach Cordis through relative or same-package type references; positive fixtures admit local and Node built-in references, a mixed installer package, and a mixed native library. The existing strict-roster manifest negative continues to reject a Cordis peer. The built native credential export loads in an isolated Node process whose resolver rejects Cordis imports.

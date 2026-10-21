# Agent Note: Transitional native source dependency gate

Status: implemented

English | [中文](2026-09-23-transitional-native-source-gate.zh.md)

## Problem

The initial strict Cordis-free source and manifest gate covered the P1 Core roster, but new P4 native Engine and Module packages were outside its source scan while they still retained mandatory Cordis peers under the pre-stable workspace policy. The P5 package policy now distinguishes strict native packages, mixed native exports, and legacy compatibility roots; each declared native source closure needs an executed check without treating the remaining legacy root as part of that closure.

## Decision

Maintain explicit source-owner sets in `native-package-policy.ts`. The executed `verify-native-dependencies` gate checks every strict native production TypeScript source in both compiler faces and rejects computed or unresolved module targets, resolved Cordis or compatibility targets, Program targets, and Core source edges into higher layers. It resolves aliases and relative paths to physical targets rather than relying on import spelling. Every Core, Engine or Module package declaring a native entry must be in the strict roster, a mixed installer/library roster, or the safe-subpath roster. For mixed packages, the gate starts at the declared native installer entry, `./native` library export, or each explicitly safe export and follows relative and same-package references, including type-only references, without scanning unrelated legacy source. The strict P1 roster retains its existing source and manifest closure checks.

The TypeScript SDK client is a strict Cordis-free owner in the Host compiler face. It remains a library that launches the named `sdk` profile; this source classification does not add a Cordis plugin entry or another application launcher.

Mixed libraries with a native export but no installer manifest use a separate explicit roster. The gate validates the export declaration path and checks its reachable source in each declared compiler face. This admits native credential definitions while keeping their Cordis service and event declarations on the legacy entry.

The transitional gate does not treat a source-only pass as a Cordis-free package claim. Strict native packages now omit Cordis peers; mixed packages may keep Cordis only as an optional peer for a legacy root entry while the declared native exports remain Cordis-free. Source checks cover strict packages in both compiler faces and follow each mixed native entry, library export, or safe subpath. The complete installed product closure and independent-consumer behavior remain separate P5 acceptance checks.

## Alternatives considered

**Put every P4 package in the strict roster now:** The existing mandatory Cordis peers would make the gate fail before the planned manifest and distribution migration, obscuring direct source regressions that can already be rejected.

**Search source text for `cordis`:** Text matching misses aliases, relative imports, re-exports, module augmentations and type-only references, while flagging comments and harmless data.

**Permit unresolved imports until P5:** An unresolved workspace target can conceal a forbidden dependency, so the source check refuses it immediately.

## Consequences

The source policy keeps separate strict native owners, mixed installer entries, mixed native libraries, and safe Cordis-free subpaths exported from legacy packages. The gate scans strict owners in both compiler faces and follows each mixed export from its declaration through relative and same-package references, including transitive type references and aliases. Mixed package roots may still expose compatibility code; the final cross-package artifact and manifest closure remains an explicit P5 requirement.

The `credentials` and `launch-environment` packages use the mixed-library roster because their `./native` exports supply values and types rather than installers. Credential key constructors and data types are shared with the legacy service; Cordis event declarations remain in the legacy `./types` export. The launch snapshot and SSH query are shared with the legacy context adapter, while `launchEnvironmentOf(ctx)` stays on the root export. A native credential Provider is still required for an operational profile.

## Verification

Verifier tests reject Cordis and Program aliases, type-only references, computed and unresolved loads, Core-to-Engine imports, unclassified native entries, and mixed exports that reach Cordis through relative or same-package type references. Positive cases cover local and Node built-in references, a mixed installer package, a mixed native library, and a safe subpath; the strict-roster manifest case still rejects a Cordis peer. A built native credential export also loads in an isolated Node process whose resolver rejects Cordis imports. These checks prove source and selected export behavior, not every product distribution.

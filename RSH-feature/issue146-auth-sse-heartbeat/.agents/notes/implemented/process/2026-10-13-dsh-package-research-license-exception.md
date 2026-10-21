# Agent Note: DSH package research license exception

Status: implemented

English | [中文](2026-10-13-dsh-package-research-license-exception.zh.md)

## Problem

The package license check requires MIT for every DSH release package. The `@deepseek-ai/dsh-acp-child` release package must carry the repository's RedSpark license file, so the broad rule rejects its declared package license.

## Decision

[`verify-dsh-package-licenses`](../../../../rsh/Scripts/verify-dsh-package-licenses.ts) keeps MIT as the rule for DSH packages and recognizes one exception for the workspace manifest at [`acp-child/package.json`](../../../../rsh/Modules/Official/subagent/acp-child/package.json) with the exact name `@deepseek-ai/dsh-acp-child`. That manifest must declare `SEE LICENSE IN LICENSE-REDSPARK-RESEARCH.txt`, list that file in `files`, and ship a package copy byte-identical to the root [`LICENSE-REDSPARK-RESEARCH.txt`](../../../../LICENSE-REDSPARK-RESEARCH.txt). A different package name at the reserved path, the same name at another path, a changed declaration, or a missing or changed license file fails the check.

## Alternatives considered

- **Change the package declaration to MIT** — rejected because it would not match the license file that the package is required to carry.
- **Allow non-MIT declarations for every DSH package or by package name alone** — rejected because it would weaken the existing rule for unrelated packages and would not require the license text to be published.

## Consequences

The other DSH packages remain subject to the MIT declaration. When the root RedSpark license text changes, the ACP child package copy must be updated with it before the license check passes.

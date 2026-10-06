# Agent Note: Keep the PowerShell compatibility registry peer optional for Native consumers

Status: implemented

English | [中文](2026-10-07-native-pwsh-compatibility-peer.zh.md)

## Problem

`dsh-tool-pwsh` publishes both a Cordis entry and a Native entry. The Cordis entry imports `dsh-tools`, while the Native entry imports `dsh-native-tools`; a required `dsh-tools` peer makes a Native-only package selection close over legacy peers that the Native entry does not use.

## Decision

Keep `dsh-tools` as a peer and development dependency for the Cordis entry, and mark only that peer optional in `dsh-tool-pwsh`. The package dependency policy allows this exact Host peer only because the package exports `./native`; the Native/compatibility import policy permits the legacy value import in the Cordis entry and rejects it from the Native entry's source closure.

The Windows Native profile continues to select `dsh-pwsh-sandbox` and `dsh-tool-pwsh`. The CLI package still declares Cordis and `dsh-tools` directly for its other supported profiles, so this package-level optional peer does not make a full CLI installation Cordis-free.

## Alternatives considered

Removing the peer would leave the Cordis entry's runtime requirement undeclared. Making the `dsh-tools` peer optional across packages would weaken unrelated compatibility contracts. Splitting the PowerShell tool into separate packages would duplicate or relocate shared model-facing behavior without being needed to close the Native dependency edge.

## Consequences

Native-only consumers may omit `dsh-tools` and its Cordis peer closure. A consumer that loads the default Cordis entry must install `dsh-tools`; optional peer metadata does not install or validate that compatibility face. The native profile row, native services, approval behavior, job ownership, and PowerShell execution remain unchanged.

## Verification

The package dependency gate checks that `dsh-tools` remains a matching peer and development dependency, that it is optional only for this package's separate Native export, and that the edge is not optional when either requirement is absent. The source import gate scopes the value import to the Cordis entry. The Windows Native profile composition and real PowerShell behavior are covered by the selected-profile and Native PowerShell checks recorded with the change.

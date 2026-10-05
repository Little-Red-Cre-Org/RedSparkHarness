# Agent Note: Filesystem compatibility uses the verified Cordis release

Status: implemented

English | [中文](2026-10-05-compatibility-filesystem-version-support.zh.md)

## Problem

Accepting every string beginning with `4.` admits malformed manifests and unverified Cordis releases before plugin activation. The adapter allowlist also needs an explicit account of its services, configuration and lifecycle support.

## Decision

The optional filesystem compatibility runtime accepts exactly Cordis 4.0.2, the pinned vendored release. Its README owns the first Host adapter matrix for the same-version RSH packages. Each adapter retains its existing configuration validation and native cleanup ownership. Loader configuration, HMR and Client adapters remain unsupported.

## Alternatives considered

A major-version range would assert compatibility beyond the tested vendored source. Adding a user override would weaken the activation check without verification.

## Consequences

Malformed, prerelease and other-version manifests reject before Context creation. Updating the supported release requires updating the pin and verifying the affected adapter set. This change does not alter vendor sources, default profiles or Session formats.

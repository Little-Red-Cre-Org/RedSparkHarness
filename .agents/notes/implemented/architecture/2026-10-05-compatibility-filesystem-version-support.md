# Agent Note: Filesystem compatibility uses the verified Cordis release

Status: implemented

English | [中文](2026-10-05-compatibility-filesystem-version-support.zh.md)

## Problem

Accepting every string beginning with `4.` admits malformed manifests and unverified Cordis releases before plugin activation. The adapter allowlist also needs an explicit account of its services, configuration and lifecycle support.

## Decision

The optional filesystem compatibility runtime accepts exactly Cordis 4.0.2 and Loader 1.0.3. One support record pins the four filesystem DSH packages and the shared `dsh-tools` and `dsh-system-prompt` Cordis plugins at 0.1.5-rc.2. The filesystem packages must declare their recorded DSH runtime API, role, and capability; the shared Cordis plugins have no `dsh.runtime` declaration, so the runtime checks their installed package identity and version, uses the RSH `adapter` descriptor, and requires their declared services after startup. Selected plugins run as entries in the shared Loader. Configuration updates, enable, disable, and removal drain Native tools, in-flight prompt assembly, event listeners, and admitted calls before applying the Loader operation; Native profile replacement remains a separate operation. Module-code HMR, arbitrary plugins, legacy application bundles, and Client adapters remain unsupported. See [the Loader entry lifecycle decision](2026-10-06-native-compatibility-loader-entry-lifecycle.md).

## Alternatives considered

A major-version range would assert compatibility beyond the tested vendored source. Adding a user override would weaken the activation check without verification.

## Consequences

Malformed, prerelease and other-version manifests reject before Context creation. Updating a supported release requires updating the pin and verifying the affected adapter set. Loader entry configuration does not create a legacy Agent loop or Session writer. This decision does not alter vendor sources, default profiles or Session formats.

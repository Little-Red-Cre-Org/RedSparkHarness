# Agent Note: Native compatibility bridge

Status: implemented

English | [中文](2026-09-22-native-compatibility-bridge.zh.md)

## Problem

The native filesystem and headless profile need selected legacy filesystem implementations during the staged migration, but starting a legacy bundle would introduce competing Agent, tool, and Session writers.

## Decision

The optional `compat-dsh-runtime` creates one Cordis Context and exposes it only to the selected compatibility bridges through the `compatDshRuntime` service. The bridges mount allowlisted plugins through `dsh-plugin-host`, which owns child Fibers and descriptor registrations. `compat-fs-local` and `compat-fs-sandbox` each provide `fs`; the sandbox variant requires native policy selection. `compat-fs-policy` forwards native filesystem events into the legacy observation policy and provides the policy authority marker. `compat-tool-fs` registers selected legacy tools and prompt sections into native registries, while the native headless application validates calls and appends exactly one Session result.

Each bridge reads and validates its selected package metadata and configuration before mounting a plugin. The compatibility runtime validates Cordis major version 4 and refuses package names outside its first-party allowlist. Duplicate Providers and policy authorities fail while resolving the native installation. Bridge disposal waits for admitted legacy tool execution, removes owned native contributions, and awaits its child Fiber; Host shutdown drains the shared Context. Native installations that omit `compat-dsh-runtime` do not load Cordis through this compatibility path. The compatibility profile exercises the published `dsh` command with a legacy write tool, filesystem change, model-visible prompt and schema, and one durable result.

## Alternatives considered

**Load the legacy base bundle.** It was rejected because it owns an Agent loop, Session state, and tool runtime that conflict with native authorities.

**Rewrite the selected legacy packages immediately.** It was rejected because the staged migration needs behavior evidence from the maintained filesystem implementations before their replacement phases.

**Allow a sandbox bridge to select local storage when policy is absent.** It was rejected because a missing policy must fail loudly instead of widening mutation access.

## Consequences

Native profiles can consume selected legacy filesystem implementations without a second durable Session writer. The compatibility layer remains bounded to the declared packages and retains Cordis as an explicit dependency. The native policy has profile-level modes only, and broader approval, attachment, UI presentation, reload, and replacement behavior remain owned by later migration phases.

# Agent Note: Native compatibility bridge

Status: implemented

English | [中文](2026-09-22-native-compatibility-bridge.zh.md)

## Problem

The native filesystem and headless profile need selected legacy filesystem implementations during the staged migration, but starting a legacy bundle would introduce competing Agent, tool, and Session writers.

## Decision

The optional `compat-dsh-runtime` creates one Cordis Context and exposes it only to the selected compatibility bridges through the `compatDshRuntime` service. The bridges mount allowlisted plugins through `dsh-plugin-host`, which owns child Fibers and descriptor registrations. `compat-fs-local` and `compat-fs-sandbox` each provide `fs`; the sandbox variant requires native policy selection. `compat-fs-policy` forwards native filesystem events into the legacy observation policy and provides the policy authority marker. `compat-tool-fs` registers selected legacy tools and prompt sections into native registries, while the native headless application validates calls and appends exactly one Session result.

Each bridge validates its selected package metadata and configuration before mounting a Loader entry in the shared Cordis Context. The runtime checks exact Cordis 4.0.2 and Loader 1.0.3 releases, plus the supported DSH package declarations, before activation. Native tools and prompt sections drain admitted tool calls and in-flight prompt assembly before Loader updates; policy listeners drain before their entry changes. Bridge disposal removes owned Native contributions, and Host shutdown drains the Context. Native installations that omit `compat-dsh-runtime` do not load Cordis through this compatibility path. The compatibility profile exercises the published `dsh` command with a legacy write tool, filesystem change, model-visible prompt and schema, and one durable result. [The Loader entry lifecycle decision](2026-10-06-native-compatibility-loader-entry-lifecycle.md) owns the support matrix and reload distinction.

## Alternatives considered

**Load the legacy base bundle.** It was rejected because it owns an Agent loop, Session state, and tool runtime that conflict with native authorities.

**Rewrite the selected legacy packages immediately.** It was rejected because the staged migration needs behavior evidence from the maintained filesystem implementations before their replacement phases.

**Allow a sandbox bridge to select local storage when policy is absent.** It was rejected because a missing policy must fail loudly instead of widening mutation access.

## Consequences

Native profiles can consume selected legacy filesystem implementations without a second durable Session writer. The compatibility layer remains bounded to the declared packages and retains Cordis as an explicit dependency. The native policy has profile-level modes only, and broader approval, attachment, UI presentation, reload, and replacement behavior remain owned by later migration phases.

## Testing

The bridged filesystem events are `fs/observed` (sync) and the `fs/write-intent` and `fs/edit-intent` waterfalls. These are every event the Native and Cordis filesystem domains declare or dispatch; neither declares a parallel or serial filesystem event, so the bridge has no such mode to adapt. The `compat-tool-fs` waterfall case compares Native-originated and Cordis-originated dispatch for listener order, `next()` delegation through both sides to the caller's terminal, throws, short-circuit, and async rejection. The `compat-fs-policy` case covers Native-to-Cordis forwarding into the observation policy, which terminates the waterfall by design rather than delegating to later Native listeners. The `compat-fs-local` case runs the production Native `read` and `write` tools against the Cordis fs-local Provider and replaces that Provider with a fresh instance using a different `cwd`. It asserts that replacement aborts a write admitted on the old backend with `FS_ABORTED`, that no `fs` service is published when the old backend's cleanup begins, that the cleanup completes before the replacement settles and the substitute then serves the next read, that the retained old instance refuses new I/O, and that removal leaves the live proxy reporting the service as unavailable.

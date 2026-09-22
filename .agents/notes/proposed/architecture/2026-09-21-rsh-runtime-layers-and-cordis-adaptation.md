# Agent Note: RSH runtime layers and Cordis adaptation

Status: proposed

English | [中文](2026-09-21-rsh-runtime-layers-and-cordis-adaptation.zh.md)

## Problem

The RSH physical layout identifies package ownership, but current Cordis composition still permits a consumer to depend on a concrete Provider or a Core package to reach product code. A directory name alone cannot distinguish a valid capability Definition dependency from an implementation leak. RSH also needs a native ownership record without breaking current DSH profiles or treating the vendored Cordis runtime as a replaceable product plugin.

## Proposal

The [native-runtime proposal](2026-09-22-rsh-native-runtime-and-optional-cordis.md) supersedes this proposal's choice of Cordis as the sole execution framework. This record retains the role classification, adapter behavior and dependency-policy rationale applicable to legacy composition.

RSH has five runtime owners: Core provides substrate services and the owned Cordis framework; Engine owns Agent execution and durable Agent data; Modules provide capability Definitions, Providers, Consumers, policies, and projections; Compatibility composes profiles and adapts supported ecosystems; Programs host, transport, and present the composed application. Dependency checks apply these ownership rules to declared runtime edges rather than asserting a single directory-order DAG.

A native package declares `dsh.runtime` with API revision, capability, and role. `dsh-plugin-host` reserves that declaration for an active Fiber and adapts a legacy Cordis plugin without wrapping its services, events, loader configuration, or disposal. Cordis remains the sole plugin runtime. Filesystem is the first capability pilot: its Definition, Providers, Consumers, and observation policy receive role declarations and profile rows select their adapter subpaths while retaining the existing `ctx.fs`, tool schemas, Session events, and patch IDs.

## Runtime ownership

- Core never consumes Engine, Module, Compatibility, or Program APIs.
- Engine never consumes Compatibility or Program APIs and never selects a Module Provider.
- A Module Consumer consumes a published Definition or registry, never a Module Provider.
- Compatibility may compose published Providers and Program-facing application packages but does not own Agent behavior.
- Programs host public composition and do not own Agent loops or concrete Provider behavior.

A narrow reviewed exception names each legacy manifest edge and fails validation once the edge disappears. Community experimental packages retain their existing product-integration freedom until their runtime roles are designed.

## Alternatives considered

**Replace Cordis with an RSH plugin runtime:** Rejected. Cordis already owns Context, Loader, services, events, and Fiber cleanup; another runtime would duplicate lifecycle authority and disrupt profiles.

**Treat physical folders as a strict dependency DAG:** Rejected. Capability Definitions, composition bundles, and program-facing client packages have legitimate role-specific relationships that a directory-only rule cannot classify.

**Rewrite every existing plugin before adding native metadata:** Rejected. Adapter-first migration preserves current profiles and allows one capability family to prove the model before broader conversion.

## Acceptance criteria

- Runtime manifest declarations have one documented API revision and reject malformed roles or capabilities.
- The constraint check rejects Core/product, Engine/Program, Engine/Provider, and Consumer/Provider runtime edges, with no stale reviewed exception.
- An adapter-mounted legacy Cordis plugin registers and releases its descriptor with its owning Fiber.
- The base profile mounts the plugin host before adapted filesystem policy, Consumer, and sandbox Provider rows.
- Filesystem behavior, model-visible content, Session format, and profile patch row IDs remain unchanged.
- Focused role-policy, adapter lifecycle, filesystem integration, base composition, Cordis configuration, type, documentation, and built artifact checks pass.

## Risks

`dsh.runtime` declarations are public pre-stable metadata, so their vocabulary must stay small until real compatibility readers enforce it. The adapter does not sandbox same-process code; external plugins remain trusted until a separate compatibility bridge supplies explicit grants and process isolation. Manifest checks see declared package edges only; a later Host/Client source-import pass must resolve actual package owners before it enforces imports.

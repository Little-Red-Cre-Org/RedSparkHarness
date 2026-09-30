# Agent Note: Cordis-free Client UI foundations

Status: implemented

English | [中文](2026-09-24-cordis-free-client-ui-foundations.zh.md)

## Problem

The Client slot contract exposed Cordis `Context` only to let the renderer observe a scope owner's teardown. The shared store source also declared its Zustand and Immer runtime imports as development dependencies, so its manifest did not describe the package it publishes.

## Decision

`ScopedStandardSourceBinding` carries `SlotScopeLifetime`, which identifies one scope generation and accepts cleanup without naming a framework. The existing Cordis-backed `ui-session` adapter translates `Context.effect` into this interface. The React-free store package declares Zustand and Immer as runtime dependencies and no longer requires Cordis. The package dependency checker lists those retained ESM imports as Client runtime dependencies; other browser build inputs remain development-only. The UI slots package depends on the store types and no longer requires Cordis.

The React renderer, slot registry service, and assembled Client plugins still use Cordis. These shared UI packages are reusable native foundations; their extraction does not declare the production Client migrated.

## Alternatives considered

**Keep exposing Cordis `Context` on each scoped binding:** The renderer needs only scope identity and teardown, so this would keep native Client owners dependent on Cordis and expose unrelated runtime APIs.

## Consequences

Native Client scope owners can supply teardown through their runtime resource owner without importing Cordis types. Existing Cordis sessions still clear slot stores when their scope ends. The native dependency gate checks both shared packages and their declarations. The package dependency gate requires the Client runtime dependency roster to match source imports.

## Verification

The Client scope binding and store lifetime suites verify Cordis adapter cleanup. Native dependency checks reject Cordis source and package edges for both packages. Package dependency checks verify the reviewed Client runtime import roster, and the packed consumer test resolves the declared libraries. Package builds and the paired documentation gates verify exported types and dependencies.

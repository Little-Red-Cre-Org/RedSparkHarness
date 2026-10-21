# Agent Note: Desktop native Client preview routing

Status: implemented

English | [中文](2026-09-24-desktop-native-client-preview.zh.md)

## Problem

The native browser bootstrap can compose Client plugins without Cordis, but Desktop had no validated package selection, shared browser module graph, or Host-owned route for the resulting assets. The legacy Web entry still owns the default page.

## Decision

The private Desktop Host reads optional `rsh.client.json` from its project root. Revision 1 lists unique installation ids, installed package names, and optional JSON configuration. Package lookup is limited to the Desktop project and bundled runtime. The Host validates the package identity and published `dsh.native` export before importing it, requires the `client` target, and rejects a compiled graph containing Cordis.

All selected entries are compiled into one browser ESM bundle so shared imports keep one module instance. The Host injects the bundle URL, stylesheets, module ids, and selections into `native.html`, then serves only emitted files from its in-memory asset map. The existing `/` and `/index.html` routes remain on the legacy application. An absent Client profile leaves `/native.html` unavailable; an invalid configured profile fails Host startup without falling back.

This selector is limited to the native Client preview; it does not choose the Desktop Host composition or declare the migrated production UI. Default-page migration remains gated on a real native renderer and the P5 profile acceptance checks.

## Alternatives considered

**Keep using the Cordis Loader for the preview:** The browser path would continue to require Cordis and could not validate the native Client runtime.

**Serve each plugin entry as an independent module URL:** Shared dependencies could instantiate more than once across entries and violate Client module identity.

**Replace the default page now:** No production native Client renderer currently covers the supported application UI, so that switch would remove existing behavior.

## Consequences

The native Client bootstrap can be exercised through Desktop-owned package resolution, bundling, boot-data injection, and asset serving while the existing application remains the default. A configured but invalid preview profile blocks Host startup, making the misconfiguration visible before the browser loads.

The profile format is intentionally separate from `rsh.profile.json`: it selects browser entries only and has no scope, Host, or application semantics. It must not be treated as a replacement for the eventual default native composition.

## Verification

Focused tests cover profile validation, package resolution from both allowed roots, package and entry path confinement, Cordis rejection, one-graph JavaScript and CSS output, Host page injection, asset routing, and browser startup and pagehide cleanup.

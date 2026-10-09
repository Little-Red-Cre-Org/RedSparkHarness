# Agent Note: Desktop native Client preview routing

Status: implemented

English | [中文](2026-09-24-desktop-native-client-preview.zh.md)

## Problem

The native browser bootstrap can compose Client plugins without Cordis, but Desktop had no validated package selection, shared browser module graph, or Host-owned route for the resulting assets. The legacy Web entry still owns the default page.

## Decision

The private Desktop Host reads optional `rsh.client.json` from its project root. Revision 1 lists unique installation ids, installed package names, and optional JSON configuration. Package lookup is limited to the Desktop project and bundled runtime. The Host validates the package identity and published `dsh.native` export before importing it, requires the `client` target, and rejects a compiled graph containing Cordis.

The Native Host compiles selected entries into one browser ESM bundle so shared imports keep one module instance. It injects the bundle URL, stylesheets, module ids, and selections into `native.html`, then serves only emitted files from its in-memory asset map as the root application. The compatibility Host serves only the existing application and rejects `rsh.client.json` before startup because its Typert Session endpoints do not implement the Native Session response, follow, and image routes. It returns 404 for `/native.html` and `/.dsh/native-client/` assets; an invalid configured profile fails Native Host startup without falling back.

`rsh.client.json` selects Client entries but does not select the Host. The profile's `package.json` sets `dsh.profile.runtime: "native"` and `dsh.profile.config: "rsh.profile.json"`; `rsh.profile.json` contains the composition. The default Desktop profile remains on the compatibility Host; default-page migration remains gated on a real native renderer and the P5 profile acceptance checks.

## Alternatives considered

**Serve the Native Client from the compatibility Host:** Compatibility Session endpoints share some names but have different responses and no Native follow or image routes, so the page would not have its required Host API.

**Keep using the Cordis Loader for the preview:** The browser path would continue to require Cordis and could not validate the native Client runtime.

**Serve each plugin entry as an independent module URL:** Shared dependencies could instantiate more than once across entries and violate Client module identity.

**Replace the default page now:** No production native Client renderer currently covers the supported application UI, so that switch would remove existing behavior.

## Consequences

The native Client bootstrap can be exercised through Desktop-owned package resolution, bundling, boot-data injection, and asset serving while the existing application remains the default. A configured but invalid preview profile blocks Host startup, making the misconfiguration visible before the browser loads.

The profile format is intentionally separate from `rsh.profile.json`: it selects browser entries only and has no scope, Host, or application semantics. It must not be treated as a replacement for the eventual default native composition.

## Verification

Focused tests cover profile validation, package resolution from both allowed roots, package and entry path confinement, Cordis rejection, one-graph JavaScript and CSS output, Host page injection, asset routing, and browser startup and pagehide cleanup.

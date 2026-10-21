# Agent Note: Native Client boot page handoff

Status: implemented

English | [中文](2026-10-05-native-client-boot-page-handoff.zh.md)

## Problem

The separate `native.html` entry loads Host-selected Client modules and mounts a renderer, but a pending import leaves the page blank. It renders failures with an unstyled replacement element. The existing product `index.html` already has a framework-free boot page; the native page needs the same visible installation lifecycle without importing the Cordis shell.

## Decision

Publish the DOM/CSS boot page as an independent browser entry. The native Client installer reports selected module import, rejection, and completed activation through an optional callback. The application entry projects those states onto the page, reattaches it after a failed renderer handoff, and releases it after successful mount or document unload. The existing product entry continues to use its Cordis Loader and UI roster.

The boot page entry preserves its stylesheet as a package asset for the application bundler. The `native` entry keeps its existing runtime dependency graph; it does not statically import the boot page or any Cordis module.

## Alternatives considered

**Import the main Web shell:** Rejected because that would load the Cordis context and Loader into the native page.

**Duplicate the boot page in the application:** Rejected because the two entry pages would diverge in failure presentation and styling.

## Consequences

The selected native Client graph has visible loading and failure states and a single renderer handoff. This does not migrate the supported product UI roster or change the default page. A Host-selected renderer and application Provider remain necessary for useful native UI.

## Verification

Focused native-entry cases verify initial module progress and import failure. A compiled native entry was loaded in a real browser to verify loading, renderer handoff, pagehide cleanup, and failure rendering without Cordis requests.

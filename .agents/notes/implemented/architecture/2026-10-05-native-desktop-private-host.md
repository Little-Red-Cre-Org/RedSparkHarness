# Agent Note: Explicit native Desktop private Host

Status: implemented

English | [中文](2026-10-05-native-desktop-private-host.zh.md)

## Problem

The Desktop default remains the compatibility Host. Native Client Session RPC, follow, and image routes require a Native Session controller, so a compatibility profile that selects native Client entries must fail before startup. Native installation selects the matching Host without changing existing Desktop defaults or opening a server.

## Decision

The private Host reads `dsh.profile.runtime` from the installed profile's `package.json` before importing either assembly; `dsh.profile.config` names `rsh.profile.json`, which contains the composition. Native mode shares CLI profile validation and installation planning, supplies Electron's existing Connection carrier within the same scope plan, and activates the selected Session controller and Providers once. Its selected Client replaces the root page. Both package and export realpaths must stay within the installed profile or runtime. The planning loader's only allowed computed import is the export already resolved from a validated installed manifest.

## Alternatives considered

**Start a native Web server beside the compatibility Host:** this adds a listener and another application owner, and can duplicate Agent execution. Electron already owns private framed Fetch pipes.

**Copy the CLI parser into Desktop:** independent parsers drift in manifest validation and patch behavior. A planning-only library export shares the parser without adding an application launcher.

**Allow source workspace links in installed Desktop:** this makes the signed runtime execute code outside its installed directories. The shared asset builder has an explicit installed-only mode.

## Consequences

Native mode requires startup-only config, a selected Session controller, its Providers and a native Client configuration. Cordis patches and competing carrier/application Providers are refused before activation. Electron preserves an existing explicit native profile during release preparation and rejects compatibility plugin mutations before stopping its Host. Legacy assembly and defaults remain available. The recorded Desktop Session uses the real private Host process, installed packages, Client assets and cold restoration; GUI rendering and unsupported compatibility menus remain separate acceptance work. No Session format or SDK transcript changes occur.

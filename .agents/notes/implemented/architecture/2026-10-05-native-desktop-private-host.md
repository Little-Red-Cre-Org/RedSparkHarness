# Agent Note: Explicit native Desktop private Host

Status: implemented

English | [中文](2026-10-05-native-desktop-private-host.zh.md)

## Problem

A native Client preview leaves the Desktop Agent and Session on the compatibility Host. Native installation must select the actual Host without changing existing Desktop defaults or opening a server.

## Decision

The private Host reads the explicit profile runtime marker before importing either assembly. Native mode shares CLI profile validation and installation planning, supplies Electron's existing Connection carrier within the same scope plan, and activates the selected Session controller and Providers once. Its selected Client replaces the root page. Both package and export realpaths must stay within the installed profile or runtime. Only the workspace development project, which the Desktop spawns with linked packages explicitly allowed, skips this containment and builds its Client from the workspace. The planning loader's only allowed computed import is the export already resolved from a validated installed manifest.

## Alternatives considered

**Start a native Web server beside the compatibility Host:** this adds a listener and another application owner, and can duplicate Agent execution. Electron already owns private framed Fetch pipes.

**Copy the CLI parser into Desktop:** independent parsers drift in manifest validation and patch behavior. A planning-only library export shares the parser without adding an application launcher.

**Allow source workspace links in installed Desktop:** this makes the signed runtime execute code outside its installed directories. The shared asset builder has an explicit installed-only mode.

## Consequences

Native mode requires startup-only config, a selected Session controller, its Providers and a native Client configuration. Cordis patches and competing carrier/application Providers are refused before activation. Electron preserves an existing explicit native profile during release preparation and rejects compatibility plugin mutations before stopping its Host. Legacy assembly and defaults remain available. The recorded Desktop Session uses the real private Host process, installed packages, Client assets and cold restoration; GUI rendering and unsupported compatibility menus remain separate acceptance work. No Session format or SDK transcript changes occur.

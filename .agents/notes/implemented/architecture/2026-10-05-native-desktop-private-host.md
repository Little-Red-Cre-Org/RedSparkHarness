# Agent Note: Explicit native Desktop private Host

Status: implemented

English | [中文](2026-10-05-native-desktop-private-host.zh.md)

## Problem

Each Desktop release must pair its Host with the profile runtime it supports. Native Client Session RPC, follow, and image routes require a Native Session controller, while Cordis profiles require their own compatibility Host. Shipping Cordis optional packages in every default runtime also defeats a Cordis-free Native assembly.

## Decision

The release descriptor selects either the Native assembly or an explicit compatibility assembly, and the package set requires the matching private Host at the Desktop release version. Native is the default and packages `@deepseek-ai/dsh-desktop-host` without compatibility-only optional dependencies. Compatibility packaging uses the distinct `@deepseek-ai/dsh-desktop-host-compatibility` identity and a separate target output; it includes the available legacy profile package closure. Native package-manager metadata ignores the exact compatibility-only optional names so registry resolution cannot restore them, while platform-native optional dependencies remain eligible.

New Desktop profiles select `dsh.profile.runtime: "native"` and `dsh.profile.config: "rsh.profile.json"`. Upgrade converts only the exact untouched legacy starter profile; a custom Cordis profile remains unchanged and starts only when it explicitly selects `runtime: "legacy"` and the runtime contains the compatibility assembly. Reset creates a Native profile.

The Native Host shares CLI profile validation, preset expansion, and installation planning, supplies Electron's existing Connection carrier within the same scope plan, and activates the selected Session controller and Providers once. Its selected Client replaces the root page. Both package and export realpaths must stay within the installed profile or runtime. Only the workspace development project, which the Desktop spawns with linked packages explicitly allowed, skips this containment and builds its Client from the workspace. The planning loader's only allowed computed import is the export already resolved from a validated installed manifest.

## Alternatives considered

**Start a native Web server beside the compatibility Host:** this adds a listener and another application owner, and can duplicate Agent execution. Electron already owns private framed Fetch pipes.

**Keep one compatibility Host in every release:** this makes Cordis a dependency of the default Native runtime and causes pnpm to restore the compatibility optional closure.

**Ship assembly-dependent contents under one Host package identity:** this lets two different payloads claim the same versioned npm identity, so the release descriptor cannot bind the Host package to the selected runtime.

**Convert every unmarked legacy profile automatically:** this can replace user-authored Cordis settings. Only the exact untouched starter is converted; custom profiles stay on disk until the user selects a supported runtime or resets Desktop.

**Copy the CLI parser into Desktop:** independent parsers drift in manifest validation and patch behavior. A planning-only library export shares the parser without adding an application launcher.

**Allow source workspace links in installed Desktop:** this makes the signed runtime execute code outside its installed directories. The shared asset builder has an explicit installed-only mode.

## Consequences

Native mode requires startup-only config, a selected Session controller, its Providers and a native Client configuration. Cordis patches and active profile or expanded-preset installations that declare competing carrier/application Providers are refused before installation planning; disabled installations are ignored. Electron preserves an existing explicit native profile during release preparation and rejects compatibility plugin mutations before stopping its Host. Custom Cordis profiles require an explicit compatibility release, and reset selects Native. The recorded Desktop Session uses the real private Host process, installed packages, Client assets and cold restoration; GUI rendering and unsupported compatibility menus remain separate acceptance work. No Session format or SDK transcript changes occur.

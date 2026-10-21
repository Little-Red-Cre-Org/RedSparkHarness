# Agent Note: Native IDE with VS Code Extension Compatibility

Status: proposed

English | [中文](2026-10-08-native-ide-vscode-extensions.zh.md)

## Problem

RedSpark Harness needs a first-party IDE that can edit real workspaces and use the established VS Code extension ecosystem. A Monaco-only editor would provide text editing but not the VS Code Workbench, extension host, or extension APIs. Running third-party extensions inside the Native Runtime would mix two plugin contracts and give trusted same-process plugins authority they do not need.

## Proposal

Build the IDE as a Native-profile application with a Code - OSS-based workbench. Keep RSH Native plugins and VS Code extensions as separate extension systems. The RSH packages under `Modules/Official` provide Harness-owned capabilities and a narrow integration adapter; Code - OSS owns VS Code extension discovery, activation, and API compatibility.

### Runtime and ownership

The Official Native IDE provider owns the Code OSS server and extension-host descendants. A supported `dsh` profile manages the provider; Desktop owns the enclosing Electron window and embedded view. The existing RSH Host retains Agent, Session and tool execution ownership.

Before adapter activation, Desktop delegates closure to Code OSS's unload veto rather than requiring an adapter state update that may never arrive. Reported dirty editors still block closure. Runtime and extension storage stay outside untrusted project folders so upstream trust checks do not disable the adapter; no trust override is introduced.

Code - OSS extensions run only in the extension host supplied by the selected Code - OSS build. They do not load as Native Runtime plugins, gain NativeHost service access, or receive a second RSH Agent, Session, or tool authority. An RSH-published VS Code extension may connect supported IDE commands and workspace state to RSH through a narrow, versioned interface owned by the Official Native IDE package.

The IDE provider persists its first bound loopback port and one workspace file per canonical project path. This preserves upstream browser and workspace storage without exporting its databases, replaying trust grants, or patching the editor. Tokens rotate independently of these identifiers. Port conflicts fail activation; selecting another port would select another browser origin and obscure the user's stored state. Existing workspace settings remain upstream-owned.

### Extension sources and compatibility

The qualified REH Web distribution includes the Node TypeScript service but not its browser bundle. Desktop uses upstream `configurationDefaults` and `remote.extensionKind: { "vscode.typescript-language-features": ["workspace", "-web"] }` to select Node and exclude browser fallback even while workspace trust prevents Node activation. Trusting the workspace then activates the available service. This retains upstream language features and user overrides without patching or redistributing upstream extension code. Qualification covers diagnostics, completion, definition navigation and cross-file rename through the live workbench.

Configure the Code - OSS distribution to use Open VSX. Permit installation from a local VSIX when the user has obtained it and has rights to use it. Do not point a Code - OSS-derived product at the Visual Studio Marketplace: Microsoft's FAQ says alternative Code - OSS products may not access that Marketplace ([Code - OSS differences](https://github.com/microsoft/vscode/wiki/Differences-between-the-repository-and-Visual-Studio-Code), [VS Code FAQ](https://code.visualstudio.com/Docs/supporting/faq)). Open VSX provides a registry API compatible with VS Code's extension gallery settings ([Open VSX setup](https://github.com/eclipse-openvsx/openvsx/wiki/Using-Open-VSX-in-VS-Code)).

Target the stable VS Code extension API and desktop Node.js extension host first. Treat web extensions as a separate capability. Compatibility is measured against a published extension matrix; the product does not promise that every Marketplace extension is available in Open VSX or runs on Code - OSS. Microsoft extensions with product-specific licenses and proposed-API extensions are outside the initial compatibility promise ([extension host](https://code.visualstudio.com/api/advanced-topics/extension-host), [web extensions](https://code.visualstudio.com/api/extension-guides/web-extensions), [Microsoft extension licensing](https://code.visualstudio.com/docs/supporting/oss-extensions)).

The Code - OSS source is MIT licensed, but the VS Code branded distribution contains separate Microsoft customizations and product terms. Package a separately branded and configured Code - OSS build with its notices and third-party license inventory intact ([Code - OSS product metadata](https://github.com/microsoft/vscode/blob/main/product.json)).

### First implementation slice

The [native IDE profile](../../../../rsh/Programs/Web/host/native-ide/README.md) starts a separately installed Code OSS REH Web distribution. The Official provider owns its process tree through the Native subprocess service and retains settings and extensions in the configured data directory. The [Desktop adapter](../../../../rsh/Programs/Desktop/README.md) embeds this workbench in the existing window and installs a bundled local VSIX. Code OSS owns files, editors, terminals and extensions; the extension adds project tasks and a retained RSH conversation tab. Both use the existing RSH Session authority.

The adapter uses the upstream extension API and bootstrap configuration, without modifying upstream sources or reimplementing editor services. Desktop prepares the profile through the installed CLI instead of bundling its location-dependent template loader. The provider completes VSIX installation before the server starts its extension scan; first-use workspace handoff must retain the adapter. A launch-specific Desktop protocol serves the existing conversation over private byte pipes. Parent-bound channel messages carry task summaries and navigation; no model or tool execution API is added. A separate per-webview origin serves upstream bootstrap assets locally. The integration currently requires a standard Desktop profile; native Desktop compositions report an explicit unsupported-profile message.

Local Windows verification uses VSCodium REH Web 1.135.06055 and its Node extension host. The isolated Desktop smoke covers conversation/editor switching, selected-code transfer, project handoff, dirty buffers, recorded diffs, PowerShell execution and Node debugging. Open VSX Prettier 12.4.0 installs, activates and formats a real file. Keyless file-tool replay covers approved and rejected mutations through the shipped Web Host and Client. The Desktop README owns the qualified extension matrix. Approval geometry uses an owner-local PowerShell replay on Windows, where the shipped profile has no Bash tool; the canonical POSIX Session remains unchanged. Native Desktop integration, complete visual parity, a separate task inspector, broader extension compatibility and release packaging remain outside this verified slice.

Visual integration uses a bundled theme, upstream editor/title commands and parent-bound conversation colors, without injecting layout patches into the upstream DOM. The design prototype's centered segmented switch remains unimplemented; editor-title actions avoid depending on upstream internal structure. Theme changes neither enter model context nor change saved RSH preferences; layout tests cover light and dark colors, foreign messages and disposal.

### Task and editor integration

The built-in extension appends editor selections to the existing scoped composer through revision-checked insertion, including source ranges and unsaved buffer contents. It never submits the draft. Chat file links are claimed by a Client navigation event and resolve against the originating Session's directory before opening the upstream editor. Project changes use the Code OSS workspace-folder API; the Client waits for the destination draft's persistence notification before publishing a changed project. Draft attachments and active input transactions defer the editor switch, because restarting the extension host destroys browser-owned attachment objects. The resumed extension reads its actual workspace folder instead of the original launch path. No new Session store or model request path is introduced. File mutation rows open the recorded fragments through a read-only Code OSS content provider. Each fragment receives its own comparison and preserves unknown prior text as a labeled condition. Approval details derive literal proposals from the correlated running call; the existing Host retains approval, execution, version checks and Session result ownership. No editor-side application API or upstream source patch is introduced.

The workspace menu is the project-scoped Desktop entry. Its preload exposes no filesystem or model execution API: the Client resolves the clicked Workspace from the Host projection, and Desktop validates the wire fields and canonical directory before starting the existing IDE owner. The original page stays mounted. Returning waits for its acknowledgement of the selected-session text handoff before hiding the IDE. Re-entering checks unsaved editors before restarting; background Agent execution remains under the original Host. RSH passes its active language at entry; the Desktop adapter serves the installed Simplified Chinese pack against the runtime's own NLS key indices without an upstream source patch or translation CDN.

Changed named files save after a configurable debounce (100–10000 ms, default 500); RSH exposes only the delay setting. The extension owns per-document timers and uses Code OSS focus-change saving for early tab closure. Return and project changes await save completion. Desktop shutdown requests and acknowledgements use the existing private launch directory; failed saves retain the workbench and its contents.

## Alternatives considered

- **Use Monaco as the IDE and implement compatibility in RSH.** Monaco does not include the VS Code Workbench or extension host. Reimplementing those systems would create a second editor platform and still require a substantial VS Code API implementation.
- **Load VS Code extensions as Native Runtime plugins.** The extension APIs, activation model, and runtime differ. Mapping extension code directly to NativeHost would conflate lifecycle and service ownership and would run third-party code with same-process RSH plugin authority.
- **Use the Microsoft Visual Studio Marketplace.** Microsoft's published FAQ excludes Code - OSS-derived products from Marketplace access. Open VSX and user-supplied VSIX files provide a supported source strategy without claiming equal catalog coverage.

## Acceptance criteria

- A supported `dsh` profile starts and stops the IDE without adding a second public application entry point.
- The IDE edits and saves a workspace selected by the user and preserves the existing RSH Desktop profile and session state.
- The compatibility matrix records successful installation and activation for representative themes, declarative extensions, and Node.js extensions, plus known unsupported cases.
- The IDE installs from Open VSX and local VSIX files; it does not query the Visual Studio Marketplace.
- The RSH integration extension calls only a documented, versioned Native IDE interface. VS Code extensions cannot access NativeHost services directly.
- The packaged distribution identifies itself as an RSH product based on Code - OSS and retains required notices and third-party license records.
- Desktop integration demonstrates reliable startup, workspace handoff, process cleanup, and extension-host shutdown on each supported release platform.

## Risks

Code - OSS adds a large upstream build, security-update, and merge-maintenance cost. Open VSX does not guarantee Marketplace catalog parity. VS Code extensions are executable code and may access workspace files, processes, and network through their host; Native Runtime scope does not sandbox them. Embedding Code - OSS into the current Electron shell may duplicate Electron and Node runtimes or require a maintained workbench integration. The proof of concept must measure startup, memory, package size, upgrade, and teardown before committing to a release topology.

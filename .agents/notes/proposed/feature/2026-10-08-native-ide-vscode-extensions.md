# Agent Note: Native IDE with VS Code Extension Compatibility

Status: proposed

English | [中文](2026-10-08-native-ide-vscode-extensions.zh.md)

## Problem

RedSpark Harness needs a first-party IDE that can edit real workspaces and use the established VS Code extension ecosystem. A Monaco-only editor would provide text editing but not the VS Code Workbench, extension host, or extension APIs. Running third-party extensions inside the Native Runtime would mix two plugin contracts and give trusted same-process plugins authority they do not need.

## Proposal

Build the IDE as a Native-profile application with a Code - OSS-based workbench. Keep RSH Native plugins and VS Code extensions as separate extension systems. The RSH packages under `Modules/Official` provide Harness-owned capabilities and a narrow integration adapter; Code - OSS owns VS Code extension discovery, activation, and API compatibility.

### Runtime and ownership

Add an Official Native IDE package and a supported `dsh` profile that selects it. The profile owns workspace services, RSH integration, and IDE lifecycle. Desktop owns the packaged Code - OSS runtime and its process lifecycle. The exact Workbench presentation and process transport remain a proof-of-concept decision because the existing Desktop shell and Code - OSS each own Electron and renderer lifecycles.

Code - OSS extensions run only in the extension host supplied by the selected Code - OSS build. They do not load as Native Runtime plugins, gain NativeHost service access, or receive a second RSH Agent, Session, or tool authority. An RSH-published VS Code extension may connect supported IDE commands and workspace state to RSH through a narrow, versioned interface owned by the Official Native IDE package.

### Extension sources and compatibility

Configure the Code - OSS distribution to use Open VSX. Permit installation from a local VSIX when the user has obtained it and has rights to use it. Do not point a Code - OSS-derived product at the Visual Studio Marketplace: Microsoft's FAQ says alternative Code - OSS products may not access that Marketplace ([Code - OSS differences](https://github.com/microsoft/vscode/wiki/Differences-between-the-repository-and-Visual-Studio-Code), [VS Code FAQ](https://code.visualstudio.com/Docs/supporting/faq)). Open VSX provides a registry API compatible with VS Code's extension gallery settings ([Open VSX setup](https://github.com/eclipse-openvsx/openvsx/wiki/Using-Open-VSX-in-VS-Code)).

Target the stable VS Code extension API and desktop Node.js extension host first. Treat web extensions as a separate capability. Compatibility is measured against a published extension matrix; the product does not promise that every Marketplace extension is available in Open VSX or runs on Code - OSS. Microsoft extensions with product-specific licenses and proposed-API extensions are outside the initial compatibility promise ([extension host](https://code.visualstudio.com/api/advanced-topics/extension-host), [web extensions](https://code.visualstudio.com/api/extension-guides/web-extensions), [Microsoft extension licensing](https://code.visualstudio.com/docs/supporting/oss-extensions)).

The Code - OSS source is MIT licensed, but the VS Code branded distribution contains separate Microsoft customizations and product terms. Package a separately branded and configured Code - OSS build with its notices and third-party license inventory intact ([Code - OSS product metadata](https://github.com/microsoft/vscode/blob/main/product.json)).

### First implementation slice

The [native IDE profile](../../../../rsh/Programs/Web/host/native-ide/README.md) opens a separately installed Code OSS REH Web distribution in a browser. The Official provider owns its process tree through the Native subprocess service and stores settings and extensions under the configured data directory. This first slice retains upstream extension APIs without an RSH-owned implementation of those APIs. It does not include Desktop embedding, an agent command bridge or a redistributed runtime.

Local Windows verification uses VSCodium REH Web 1.135.06055 (VS Code API 1.135.0, Node 24.18.1). A local VSIX fixture `rsh-local-verification.native-ide-smoke@0.0.1` installs, activates in the Node extension host, and executes its registered command. Browser automation edits and saves a real workspace file through the workbench. These observations cover one fixture, not third-party extension compatibility or a release platform matrix. Open VSX installation, representative third-party extensions, Desktop integration and packaging remain acceptance work.

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

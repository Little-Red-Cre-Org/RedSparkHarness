# Agent Note: IDE AI sidebar and code actions

Status: implemented

English | [中文](2026-10-10-ide-ai-sidebar-code-actions.zh.md)

## Problem

The conversation occupied an editor tab, and transferring an Assistant code block required copying and pasting.

## Decision

The bundled Code OSS extension owns a retained secondary-sidebar webview. Chat forwards explicit insert and preview gestures through its existing private parent channel. The extension accepts actions only for the selected Session and edits the last text editor. Insertion replaces a selection or inserts at the cursor; preview replaces a selection or the whole document. Immutable diff documents expose apply and discard commands. Applying checks the target document version before editing, and successful edits enter the ordinary editor undo and auto-save flow.

## Alternatives considered

Keeping a second editor group for chat still occupies editor space. Automatically applying model output removes the user's choice. A second agent backend duplicates Session ownership; the existing conversation remains authoritative.

## Consequences

Desktop displays a self-contained preparation document before navigating the IDE view. It keeps startup status visible while the loopback document is pending, without retrying the server or changing browser security settings.

The IDE view disables Electron background timer throttling. Its editor and conversation channel remain responsive when the window is occluded. This also keeps renderer timers active when minimized, trading background power use for command and save progress.

Project controls share the RSH AI toolbar. Creating a project makes an empty directory exclusively; opening an existing folder uses the upstream folder picker. Both switch the editor through the existing saved-document and conversation handoff, without a second workspace or Session backend. New files use the upstream untitled editor.

Editor and conversation remain visible together. The callback is absent outside the IDE and disabled while code streams. Preview detects intervening edits but performs no patch inference or multi-file merge. The secondary-sidebar contribution requires an upstream runtime supporting that contribution point.

IDE conversation navigation uses the current Workspace Session list and existing New Session action, including blank conversations. The embedded frame omits both nested sidebars. The Desktop menu can open an authenticated local browser relay to the same Host, so Sessions, memory and persisted settings have one writer. Browser access stops with Desktop; it does not synchronize independent Web profiles.

Editor Run and AI run requests share Code OSS Task execution and its visible terminal. The official IDE module owns an authenticated MCP endpoint through NativeHost; Desktop composes the existing MCP client rather than a new Cordis adapter. Separate credentials distinguish tool callers from the extension executor. AI execution requires a matching workspace and local confirmation; output stays in the terminal, and model-visible results report identity and status only. Python uses configured ProcessExecution arguments without shell interpolation; project tasks remain upstream-owned. Owner-local snapshots cover the tool result and execution/trust controls without a paid model call.

MCP retains each initialized transport so cancellation reaches the original pending tool call. The adapter checks cancellation before starting a task; a cancelled confirmation cannot start a later run. The real-protocol test covers this alongside successful dispatch and unavailable-executor results.

Java execution uses the installed JDK compiler followed by its runtime, including JDK 8 where source-file launch is unavailable. Both children inherit the task terminal for interactive input and diagnostics. Fresh temporary class output prevents a failed compilation from running stale workspace bytecode; normal completion removes that output. Forced process-tree termination can leave temporary bytecode for operating-system cleanup. Maven and Gradle builds remain project tasks rather than inferred build commands.

Run visibility depends on the editor URI scheme, not its language: untitled documents enter the save flow, and languages without a direct runner offer project tasks. C/C++ use the configured GCC-compatible compiler and an isolated executable per invocation, so a failed edit cannot run an older workspace binary. Compiler-directory PATH changes belong only to the task process and its children, preserving the user's global environment while allowing MinGW runtime libraries to load.

Windows IDE chrome reuses the upstream title bar instead of maintaining a second navigation row. Desktop supplies a branded menu through its existing workbench protocol handler; menu requests require the workbench origin. Native caption controls retain reserved space, interactive controls exclude the drag region, and returning to RSH restores the original caption height. Session navigation keeps the existing native select and actions with consistent sizing.

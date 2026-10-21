# Agent Note: Integrated Windows title bar

Status: implemented

English | [中文](2026-09-13-desktop-title-bar.zh.md)

## Problem

A separate system title and menu strip disconnect desktop chrome from the RedSpark theme and consume workspace height.

## Decision

Windows uses Electron's hidden title bar with native controls overlay. The isolated preload owns a compact draggable header and an accessible application-menu button without exposing new JavaScript privileges to the Web client. Main validates owned renderer origins and hex colors before updating native control colors. The self-contained recovery document retains a draggable area even when preload fails. Other platforms retain their system frame.

## Alternatives considered

**Draw window buttons in HTML:** this requires recreating system behavior and accessibility. Native overlay controls retain OS-owned window actions.

**Put Electron chrome in the shared Web layout:** this couples browser presentation to shell operations. Preload-owned chrome keeps Web unchanged and also covers shell startup and plugin documents.

## Consequences

The header reserves 40 pixels above the application. Focused tests cover platform exclusion, menu dispatch, theme synchronization and rejected IPC requests. Native drag, snap layouts and caption hit testing require Windows GUI acceptance; tests with mocked Electron do not prove them. Desktop runtime, signing and package authorization decisions remain independent.

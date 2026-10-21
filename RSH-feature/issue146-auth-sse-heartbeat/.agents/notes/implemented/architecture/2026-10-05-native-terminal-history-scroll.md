# Agent Note: Native terminal history scrolling

Status: implemented

English | [中文](2026-10-05-native-terminal-history-scroll.zh.md)

## Problem

The native terminal displayed only its latest transcript rows, preventing users from revisiting retained messages.

## Decision

The native view uses the existing shared viewport calculation and line estimates. Page Up and Page Down change the bounded offset. Sending input, restoring a Session or clearing the view resets it to the bottom. The shared TypeScript entry exposes the JavaScript viewport with its row type preserved.

## Alternatives considered

A separate viewport implementation would duplicate the existing terminal calculation.

## Consequences

Scrolling changes presentation only. It admits no model request and rewrites no Session data. The configured transcript retention limit still bounds available history; large individual messages retain the existing renderer limits.

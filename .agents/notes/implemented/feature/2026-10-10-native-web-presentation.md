# Agent Note: Native Web conversation presentation

Status: implemented

English | [中文](2026-10-10-native-web-presentation.zh.md)

## Problem

The native Web profile displayed unstyled controls without identifying its role beside the IDE. A manually opened test page looked like an unfinished IDE launch screen.

## Decision

Keep the existing native conversation controller and Host composition. The Client bundle owns scoped styles for conversation navigation, welcome, transcript, composer and Settings. Locale dictionaries identify the page as Web conversations and explain where coding takes place. Narrow viewports place navigation above the conversation.

## Alternatives considered

Redirecting every Web visit to the IDE would remove standalone Web access. Adding a second application or a theme dependency would expand a local presentation change.

## Consequences

Session data, model requests and launch behavior are unchanged. The Web Host prints its URL; browser opening belongs to the caller. Test launchers must close their own browser and server after verification. This page remains a conversation interface, with no editor or automatic navigation to the desktop application.

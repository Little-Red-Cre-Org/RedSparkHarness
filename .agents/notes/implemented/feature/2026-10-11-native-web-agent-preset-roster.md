# Agent Note: Native Web manages native Agent preset folders

Status: implemented

English | [中文](2026-10-11-native-web-agent-preset-roster.zh.md)

## Problem

The native Host owns preset folders, while the native Web Settings page needs enough detail and file operations to help users work with them.

## Decision

`native-application` uses the selected `client-native-session` Consumer to list presets, read folder metadata and raw native composition text, copy ready folders into the Host user directory, delete user folders, and open or reveal user folder paths. It shows preset source and status; profile-only compositions have metadata but no folder content. Copy and delete publish `agent-presets/updated` through the existing settings event stream, and the view reloads the roster on that event. Native code owns the file operations and imports no legacy preset runtime.

## Alternatives considered

**Keep the read-only roster.** That would expose preset names but leave users without the existing copy, delete, detail, and folder-location operations.

**Import the legacy `ui-agent-preset` runtime.** Its Settings controls depend on legacy registrations and Cordis remotes; native Host APIs own these operations directly.

## Consequences

The Host remains the authority for the roster and filesystem. Copy never replaces a destination and preserves the source description while using the optional new display name. Delete and folder opening refuse system presets. Deleting a startup-loaded folder removes it from fresh roster reads and preset resolution while Sessions already using its mounted generation continue; the plugin scope remains until profile reload. A copied folder appears in the live roster, while its composition is not installed into the running profile until the Host reloads its profile.

## Verification

One Host test covers reading, copying, read-only refusal, deletion, and update events. One Native Application test covers details, copy, path reveal, event-driven reload, and deletion.

## Related

The preset composition decision is recorded in [A session's agent is composed from a preset cordis.yml](../architecture/2026-08-03-per-session-agent-presets.md). The selected Client operation is documented in the [native Session package](../../../../rsh/Programs/Web/client/native-session/README.md).

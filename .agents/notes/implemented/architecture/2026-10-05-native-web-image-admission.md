# Agent Note: Native Web images retain root admission and durable identity

Status: implemented

English | [中文](2026-10-05-native-web-image-admission.zh.md)

## Problem

Native browser conversations need uploaded images to reach the selected model and remain visible after reload. Browser-owned bytes cannot reconstruct model history, and a separate image preflight can race Session-local model selection.

## Decision

The root executor accepts a root-only input preparation callback under its existing execution owner. Preparation receives the effective next model route and composed cancellation before inbox admission; it returns an identified user message without writer access. It takes priority over direct message input. Web resolves that route's image capability, then uses the selected attachment Provider to promote ordered uploads to durable references. Failed preparation admits no user input or model request.

The authenticated image endpoint searches complete Session history, including inherited image references, and checks the configured workspace before storage access. Caller-supplied references and filesystem paths are not accepted. The attachment Provider verifies the recorded image and returns raster bytes within its configured image limit. The browser validates response media type and length and owns fetch cancellation and Blob URL release.

## Alternatives considered

Browser-only previews would omit reconstructable model input. Maintenance followed by root execution would leave a model-selection race between operations; nested execution under maintenance would deadlock. A second image registry would duplicate durable attachment identity. The existing root owner and attachment Provider supply both admission and storage.

## Consequences

The explicit native-web profile preserves legacy defaults and advertises selected Provider limits. A submitted message requires text and may include images; files and audio remain separate work. The shared native renderer can be composed into Desktop, but an actual native Desktop assembly and GUI acceptance remain separate work. Cold restore displays only images found in durable Session history.

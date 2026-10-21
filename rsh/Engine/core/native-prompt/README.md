---
description: "Native profiles can assemble ordered, reversible system-prompt sections before their application logs the final prompt."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-prompt

English | [中文](README.zh.md)

## Summary

`dsh-native-prompt` collects named system-prompt sections for a native application. Sections render in numeric order and use their names as a deterministic tie-breaker. The application chooses where the resulting text appears and records that final model-visible prompt in its Session.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

The `./native` entry accepts only an empty configuration object and provides `promptSections`. A duplicate section name fails at registration. A disposer removes only the section that created it, while Provider teardown removes every remaining section.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the consuming native application that renders sections and persists its assembled system message.

#### KV Cache effect

The consuming application owns request-prefix changes from rendered sections.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Sections have no locale selection, user-interface presentation, or direct Session writer.
- The registry does not load legacy prompt plugins itself.

No invariant companion is published because rendered prompt ownership remains with the consuming application.

<a id="dev-note"></a>
### Dev Note

None.

# Agent Note: Native Web default and compatibility browser owner

Status: implemented

English | [中文](2026-10-17-native-web-default-and-compatibility-browser-owner.zh.md)

## Problem

The browser API, default Web page, and legacy Cordis shell shared one startup path and one output location. A Cordis-free Native API alone did not make the default application or its published page Native, while replacing the shared page outright would drop existing Web and Desktop compatibility consumers.

## Decision

The root and `./native` exports of `@deepseek-ai/dsh-client-web` expose the Native browser composition API. `./boot-page` and `./base.css` remain explicit package exports. The package has no Cordis dependency; its compiled JavaScript and declarations publish as the Native client API.

`@deepseek-ai/dsh-web-frontend` owns the default Native application page and its `dist/` output. The Native Vite input is `application/index.html`; its build rejects Cordis package modules and vendored Cordis source paths from the resolved module graph.

`@deepseek-ai/dsh-web-compatibility` owns `AppWebEntry`, the legacy browser module table, and the legacy and preview pages. It builds from the shared Web application source into its own `dist/`. Its `dist/index.html` is the legacy page; `dist/preview.html` and `dist/preview/` are private preview outputs and are excluded from the npm payload. Existing legacy Web and Desktop Host consumers resolve this package explicitly. The Cloudflare preview workflow builds this owner.

The Native Web asset handler resolves the Native frontend page. Compatibility Web and Desktop asset consumers resolve the compatibility package page. Desktop owns profile initialization and selection; this batch's asset handler selects its page from the explicit runtime.

## Alternatives considered

**Build both page variants into one package output.** A shared output would let one flavor overwrite or publish files required by the other and make the package contents depend on the last build.

**Duplicate the legacy browser API and application source.** Copies would let the Native and compatibility implementations drift; the two Vite entries use the shared application source and keep only their own package output.

**Remove the Cordis shell when making Native the default.** Existing Web, Desktop Host, plugin-table, and preview consumers still use the compatibility path.

## Consequences

The default browser API and application have a Cordis-free owner and a separate distribution. Legacy startup, its module table, and preview remain available through an explicit compatibility package. Development and release builds must produce the two outputs in sequence, and the compatibility tarball carries its API and legacy page while excluding preview-only output.

# Agent Note: Native onboarding defaults and start directory

Status: implemented

English | [中文](2026-10-17-native-onboarding-defaults.zh.md)

## Problem

The native-web first-run model step opened on whichever provider the Host listed first (`amazon-bedrock`), while new Sessions use the DeepSeek route. Its API key field said the key could be left blank for environment authentication, but the step requires a key and keeps Save disabled while the field is empty. Configure later was not remembered, so every reload showed the step again. The Workspace directory browser opened in the Host home directory instead of the directory the Host was started from.

## Decision

- `readModelSetup` in `rsh/Programs/Web/client/native-application/src/onboarding.tsx` also reads `modelCatalog()` and moves the provider named by `catalog.default.provider` to the top of the list, so `ModelOnboardingView` opens on the Host's default Session route.
- `ProviderEditor` in `ui-primitives` shows `keyPlaceholder` ("Enter your API key") whenever `credentialRequired` is set. The optional settings editor keeps `keyStored` and the pi-ai `keyPlaceholderNative` text.
- Configure later writes `dsh.native.onboarding.models` = `2026-10-17.1` to `localStorage`. With that value and the welcome acknowledgement present, `NativeOnboarding` starts at `done`. Settings > Models stays the way to configure a provider later. If `localStorage` refuses the write, the step is skipped for this page only.
- `directories/list` without a path lists the native-web session controller's `cwd` (the launch directory) and every listing now carries `home`. The sidebar uses `listing.home` to shorten paths and as the browser's home crumb, so the start directory no longer replaces the home directory.

## Alternatives considered

**Allow saving an empty key during onboarding.** Rejected: a provider whose environment authentication already works is reported usable and skips the step, so an empty save would only write an unusable route.

**Pass an initial provider prop to `ModelOnboardingView`.** Rejected: ordering the list in the native composition gives the same result and also makes the default route the first option, without changing the shared view's props.

## Consequences

A first run lands on DeepSeek, the key field no longer contradicts the disabled Save button, and a skipped setup stays skipped until the version string changes. The directory browser in native-web now starts where the Host was launched; the legacy Cordis browser keeps its own Host's behavior.

## Testing

`native-application/tests/onboarding.client.spec.tsx` covers the default route being selected first, the required-key placeholder, and Configure later persisting across a remount.

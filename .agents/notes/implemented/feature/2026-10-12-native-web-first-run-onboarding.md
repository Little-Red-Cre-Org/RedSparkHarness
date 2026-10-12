# Agent Note: Native Web first-run onboarding

Status: implemented

English | [中文](2026-10-12-native-web-first-run-onboarding.zh.md)

## Problem

The native-web composition opened directly into the application, while the legacy Web client presented a versioned welcome notice and provider setup when no usable model was configured. The native Client cannot import the Cordis feature plugin to reuse its onboarding flow.

## Decision

`ui-primitives` owns the Cordis-free `OnboardingModal`, `WelcomeNoticeView`, and `ModelOnboardingView`. The legacy adapters supply their existing Settings, credential and acknowledgement state; native-application composes the shared content inside `OnboardingSurface` and supplies callbacks from the selected `NativeSessionClient`.

Native onboarding reads the active provider directory, configurable provider directory, Settings namespaces and referenced credential facts. It offers the shared provider editor only when the Host reports no usable active provider and at least one configurable route. Provider settings use revision-checked `settingsMutate`; API keys use `credentialsSet`. Subscription sign-in remains in the Models Settings page.

The native welcome acknowledgement stores its version in origin-local `localStorage`. The onboarding header keeps native locale and theme controls available while the application root is inert.

## Alternatives considered

**Import the legacy onboarding plugin into native-application.** Rejected because its Cordis services and feature-package runtime imports do not belong in the Native Client graph.

**Add Host-owned welcome acknowledgement methods.** Rejected for this first-run flow because browser-local persistence is sufficient and the selected Host already supplies provider, Settings and credential facts. Cross-browser acknowledgement remains a separate profile-preferences capability.

**Duplicate the provider editor in native-application.** Rejected because `ui-primitives` already owns the props-only provider forms used by both compositions ([Native Models decision](../architecture/2026-10-11-native-models-settings-page.md)).

## Consequences

The welcome acknowledgement is scoped to the page origin and is not shared with other browsers. Dismissing provider setup ends the current pass; after reload, the flow checks the Host again and offers setup while no provider is usable. Authorization and account actions remain available from Models Settings, outside onboarding. The existing [Native Settings decision](../architecture/2026-10-06-native-web-settings-credentials.md) owns the Host data and credential rules.

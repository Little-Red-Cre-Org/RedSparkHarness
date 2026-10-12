# Agent Note: Native Web selects recorded model intent and installed presets

Status: implemented

English | [中文](2026-10-05-native-web-model-controls.zh.md)

## Problem

The native conversation needs provider-discovered models and reasoning efforts without a separate selection store. Composition changes must obey the same blank-root lock as other Programs.

## Decision

The Host advertises its selected model directory and installed preset metadata through authenticated Session RPC. Directory failures remain visible. Discovery is advisory; explicit routes remain owned by model resolution, and recorded routes absent from discovery remain visible.

The Client folds model intent and preset facts from durable history using their owning pure projections. Every mutation submits the displayed revision. The existing executor exclusively owns Session maintenance and the existing root execution authority performs preset epoch transitions. Retained writers synchronously reserve the selected Agent's idle maintenance before asynchronous directory resolution; cold operations reuse their existing reservation. Concurrent turns queue behind that reservation. The page stays busy until settlement and refreshes durable facts even after a stale revision failure.

The Native composer uses the Cordis-free `ModelPicker` from `ui-primitives` for model and reasoning choices. The picker reads the Host catalog and folded Session intent, refreshes through the existing model-controls action when opened, and submits choices through the existing `selectModel` action. When the initial model-controls request fails before a catalog is available, the picker remains openable before a Session is selected and shows the request error with its retry action. Agent presets remain a separate selector.

## Alternatives considered

**A Client model catalog or preset registry.** This duplicates Provider discovery and installed composition authority.

**Changing selection only in page state.** It loses intent on restore and bypasses durable resolution and blank-root locking.

**Separate model and reasoning selects.** They do not share the Cordis composer presentation and require separate controls for one model decision.

## Consequences

The explicit native-web template installs model selection. It does not install standing preset compositions; custom profiles may supply them, and an empty registry is displayed without invented choices. Legacy default assembly remains unchanged.

The Cordis and Native composers share model and reasoning presentation through `ui-primitives`; their adapters keep their own catalog state and selection actions.

The existing real HTTP case covers advertised selection, stale revision rejection, reasoning validation and locked preset rejection. The existing built Chromium scenario records actual controls, request resolution and cold restoration. No second Agent, Session writer or execution registry is introduced.

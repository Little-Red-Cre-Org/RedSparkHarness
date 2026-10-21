# Agent Note: Session model selection and prepared dispatch

Status: implemented

English | [中文](2026-10-05-native-model-selection-and-prepared-dispatch.zh.md)

## Problem

A Session needs to preserve its selected model across cold restoration. Catalog metadata and actual request defaults can differ; recording one route while dispatching another generation makes model input irreconstructable.

## Decision

The model-directory Definition belongs to NativeModelExecution. Pi and Direct Providers publish its shared adapter implementation over their actual configured routes. Catalogs advertise options but do not own a global default or decide routability.

NativeModelSelection stores complete intent only through the Program’s exact active root owner. Selection serializes revision comparison and flushes the event before acknowledging it. Headless captures intent for each admitted root step, then the model executor captures metadata and dispatch together. The Program persists prepared controls and any route-change notice before dispatch. Delegated execution retains its explicit configuration.

The browser-safe selection leaf owns the event declaration and projection. The compatibility Session API re-exports the same type. No second writer, model configuration store or protocol carrier is introduced.

Provider preparation completes before inbox consumption, so an unavailable model retains pending input. Selection preserves omitted effort; effective defaults are recorded only in prepared requests.

## Alternatives considered

Using the advertised catalog defaults for dispatch can mix metadata from one lookup with another request generation. Storing selection in an application cache loses cold recovery and fork history. Both alternatives are rejected.

## Consequences

Changing a model adds a durable model-visible notice; changing only reasoning records new request controls without a route notice. Failed resolution and stale revisions do not append selection facts. Removal fences new work and drains accepted model and directory operations. The existing adapter iterator cleanup remains responsible for paused streams.

SDK and ACP transports remain separate Consumers. This batch provides the complete directory, selection and Headless execution chain without changing default profiles, settings, auxiliary model requests or retry policy.

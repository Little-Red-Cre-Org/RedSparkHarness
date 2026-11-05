/** Native entrypoint for the Models settings page. */
export {
  plugin, createNativeModelsPage, createNativeModelsFace, createNativeDescribeFace,
  resolveNativeSchema, followInvalidations, toCredentialFacts, toNamespaceView,
  ModelsSettingsStore, createModelsOperations, en, zh, NS,
} from './native-ui.tsx'
export type {
  NativeModelsPage, NativeModelsClient, NativeDescribeClient, NativeSettingsSchemaSource,
  ModelsSettingsState, ProviderDirectoryEntry, ProviderRow,
  ModelsOperations, SettingsSchemaOperations, SettingsWriteOutcome, ModelDiscoveryOutcome,
  ModelsDescribeFace, ModelsDescribeSnapshot, ModelsRemoteFace, ModelsRemoteHost,
  ModelsSectionInjected, ModelsSectionProps,
  ModelsFooterOwnerProps, ProviderCardExtrasOwnerProps,
  DeepSeekOnboardingInjected, WelcomeNoticeInjected, ModelsKey,
} from './native-ui.tsx'

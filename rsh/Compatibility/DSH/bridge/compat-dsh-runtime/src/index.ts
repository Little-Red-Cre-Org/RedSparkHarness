/** Optional Native entry for the DSH compatibility runtime. */
export {
  plugin,
  validateCordisManifest,
  validateLoaderManifest,
  type CompatRshLifecycleParticipant,
  type CompatRshMount,
  type CompatRshRuntime,
} from './native.ts'
export { SUPPORT_RECORD, validateSupportManifest, type CompatPackageManifest } from './support.ts'

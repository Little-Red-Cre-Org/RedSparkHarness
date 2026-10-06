/** Optional Native entry for the DSH compatibility runtime. */
export {
  plugin,
  validateCordisManifest,
  validateLoaderManifest,
  type CompatDshLifecycleParticipant,
  type CompatDshMount,
  type CompatDshRuntime,
} from './native.ts'
export { SUPPORT_RECORD, validateSupportManifest, type CompatPackageManifest } from './support.ts'

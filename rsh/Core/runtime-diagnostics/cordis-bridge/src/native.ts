/** Native entry of the Cordis bridge. */
export { hostCordisPlugin, nativePluginForCordis } from './index.ts'
export type { BridgedPlugin, BridgedServices, CordisPlugin } from './index.ts'
export {
  bridgedSystemPrompt, personaServices, PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION,
} from './services.ts'
export type { BridgedSystemPrompt, PersonaServices } from './services.ts'

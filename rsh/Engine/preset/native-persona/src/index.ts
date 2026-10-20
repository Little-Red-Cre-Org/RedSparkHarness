/**
 * Native row for the shipped Cordis `persona` plugin.
 *
 * The row exists so a Native preset can set an agent's identity without a Native re-implementation
 * of the persona logic: the shipped plugin runs unmodified through the Cordis bridge.
 *
 * @module @deepseek-ai/dsh-native-persona
 */
export { plugin } from './native.ts'

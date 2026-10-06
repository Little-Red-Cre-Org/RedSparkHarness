/** Installed standing compositions selected by the actual terminal before its first turn. */
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'
import { terminalScene } from '../../rsh/Programs/TUI/native-tui/tests/terminal-scene.ts'

it('selects an installed terminal preset, locks started Sessions and restores the durable choice', async () => {
  await terminalScene(fileURLToPath(new URL('./preset-controls/', import.meta.url)), { presets: true })
})

/** Durable model intent and Provider-owned reasoning control replay through dsh. */
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'
import { terminalScene } from '../../rsh/Programs/TUI/native-tui/tests/terminal-scene.ts'

it('commits terminal model and reasoning choices, restores them and uses them for the next model turn', async () => {
  await terminalScene(fileURLToPath(new URL('./model-controls/', import.meta.url)), true)
})

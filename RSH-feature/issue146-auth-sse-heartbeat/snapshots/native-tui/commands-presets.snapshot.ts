/** Human commands and standing preset compositions through the shipped TUI profile. */
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'
import { terminalScene } from '../../rsh/Programs/TUI/native-tui/tests/terminal-scene.ts'

it('dispatches human commands and restores the selected standing scope through dsh', async () => {
  await terminalScene(fileURLToPath(new URL('./commands-presets/', import.meta.url)), { presetMode: 'shipped' },
    fileURLToPath(new URL('./preset-controls/', import.meta.url)))
})

/** Native Web expands Session search from one rail click and moves focus into its input. */
import { expect, it, onTestFailed } from 'vitest'
import { launchNativeWeb } from './native-scaffold.ts'
import { saveFailureShot } from './support.ts'

/** The sidebar's expand transition plus headroom before focus is asserted. */
const FOCUS_SETTLE_MS = 600

it('expands the search and lands focus in the input from one rail click', async () => {
  const scaffold = await launchNativeWeb({ drop: ['pi-ai'] })
  onTestFailed(() => saveFailureShot(scaffold.page, 'native-rail-search-expand'))
  try {
    const { page } = scaffold
    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    const railSearch = page.getByRole('button', { name: 'Search sessions' }).first()
    await expect.poll(async () => railSearch.getAttribute('aria-expanded'), { timeout: 10_000 }).toBeNull()

    await railSearch.click()

    const wideSearch = page.getByRole('button', { name: 'Search sessions' }).first()
    await expect.poll(async () => wideSearch.getAttribute('aria-expanded'), { timeout: 10_000 }).toBe('true')
    const input = page.getByPlaceholder('Search sessions…')
    await expect.poll(
      async () => input.evaluate(element => document.activeElement === element),
      { timeout: FOCUS_SETTLE_MS + 10_000 },
    ).toBe(true)
    expect(scaffold.pageErrors).toEqual([])
  } finally {
    await scaffold.close()
  }
}, 120_000)

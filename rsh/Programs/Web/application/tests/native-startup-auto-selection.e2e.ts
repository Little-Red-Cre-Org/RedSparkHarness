/** Native Web keeps the welcome surface mounted when the first Workspace connects. */
import { expect, it, onTestFailed } from 'vitest'
import { launchNativeWeb } from './native-scaffold.ts'
import { connectNativeWorkspace, saveFailureShot } from './support.ts'

/** Welcome-tree nodes whose identity must survive the first Workspace connection. */
interface WelcomeTree {
  readonly root: Element
  readonly main: Element
  readonly composer: Element
}

it('keeps the welcome surface and composer nodes when the first Workspace connects', async () => {
  const scaffold = await launchNativeWeb({
    silentModel: false,
    credentials: { DEEPSEEK_API_KEY: '{{SECRET_n7bq2x4m}}' },
  })
  onTestFailed(() => saveFailureShot(scaffold.page, 'native-startup-auto-selection'))
  try {
    const { page } = scaffold
    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    await expect.poll(() => composer.count(), { timeout: 20_000 }).toBe(1)
    expect(await page.locator('#root h1').innerText()).toBe('RedSpark Harness')
    expect(await composer.isEnabled()).toBe(false)
    expect(await composer.getAttribute('placeholder')).toBe('Choose a workspace to start')
    expect(await page.getByText('Let imagination ignite', { exact: true }).count()).toBe(1)
    await page.evaluate(() => {
      const refs = {
        root: document.querySelector('#root'),
        main: document.querySelector('[data-slot="main"]'),
        composer: document.querySelector('textarea'),
      }
      if (Object.values(refs).some(node => node === null)) throw new Error('incomplete welcome tree')
      ;(window as unknown as { __welcomeTree: WelcomeTree }).__welcomeTree = refs as unknown as WelcomeTree
    })

    await connectNativeWorkspace(page, scaffold.workspaceCwd, 'en')

    expect(await page.evaluate(() => {
      const before = (window as unknown as { __welcomeTree: Record<string, Element> }).__welcomeTree
      return {
        root: document.querySelector('#root') === before.root,
        main: document.querySelector('[data-slot="main"]') === before.main,
        composer: document.querySelector('textarea') === before.composer,
        composerEnabled: document.querySelector('textarea')?.disabled === false,
      }
    })).toEqual({ root: true, main: true, composer: true, composerEnabled: true })
    // The Welcome copy stays: connecting a Workspace turns on the composer
    // rather than replacing the surface with a loading state.
    expect(await page.getByText('Let imagination ignite', { exact: true }).count()).toBe(1)
    expect(await page.getByRole('button', { name: /^Select model, current /u }).isEnabled()).toBe(true)
    expect(scaffold.pageErrors).toEqual([])
  } finally {
    await scaffold.close()
  }
}, 180_000)

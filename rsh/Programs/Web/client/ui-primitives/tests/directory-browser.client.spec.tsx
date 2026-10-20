// @vitest-environment jsdom
/** The directory browser's volume picker: a host with several roots is crossable. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DirectoryBrowser } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DirectoryBrowserEntry, DirectoryBrowserListing } from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

const t = (key: string): string => key

/**
 * One Windows listing below `C:\`, reporting both volumes the host exposes.
 * @param roots - volumes the host reports.
 * @returns the listing the browser receives.
 */
function listing(roots: readonly DirectoryBrowserEntry[]): DirectoryBrowserListing {
  return {
    path: 'C:\\Users\\tester',
    home: 'C:\\Users\\tester',
    crumbs: [
      { name: 'C:', path: 'C:\\', hidden: false },
      { name: 'Users', path: 'C:\\Users', hidden: false },
    ],
    entries: [],
    truncated: false,
    roots,
  }
}

it('offers every host volume as a jump target and reports the chosen one', async () => {
  const listDirectory = vi.fn(async () => listing([
    { name: 'C:', path: 'C:\\', hidden: false },
    { name: 'D:', path: 'D:\\', hidden: false },
  ]))
  render(<DirectoryBrowser open listDirectory={listDirectory} createDirectory={async () => ''}
    onOpen={() => {}} onClose={() => {}} busy={false} t={t} />)

  const picker = await screen.findByRole('combobox')
  expect([...picker.querySelectorAll('option')].map(option => option.value)).toEqual(['C:\\', 'D:\\'])
  expect((picker as HTMLSelectElement).value).toBe('C:\\')

  fireEvent.change(picker, { target: { value: 'D:\\' } })
  await waitFor(() => { expect(listDirectory).toHaveBeenCalledWith('D:\\', expect.anything()) })
})

it('still lists a single reported root as the current volume', async () => {
  const listDirectory = vi.fn(async () => listing([{ name: 'C:', path: 'C:\\', hidden: false }]))
  render(<DirectoryBrowser open listDirectory={listDirectory} createDirectory={async () => ''}
    onOpen={() => {}} onClose={() => {}} busy={false} t={t} />)

  const picker = await screen.findByRole('combobox')
  expect((picker as HTMLSelectElement).value).toBe('C:\\')
  expect([...picker.querySelectorAll('option')].map(option => option.value)).toEqual(['C:\\'])
})

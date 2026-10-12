/** Props-only presentation of the first-run welcome notice. */

import type { ReactNode } from 'react'
import { Button } from './Button.tsx'
import css from './WelcomeNoticeView.module.css'

/** Render the welcome copy and acknowledgement action.
 * @param props - localized copy and acknowledgement state.
 * @returns the blocking welcome step.
 */
export function WelcomeNoticeView({ body, continueLabel, error, saving, onContinue }: {
  body: string
  continueLabel: string
  error?: string
  saving: boolean
  onContinue: () => void
}): ReactNode {
  return (
    <>
      <div className={css.copy}>
        {body.split('\n\n').map(paragraph => <p key={paragraph}>{paragraph}</p>)}
      </div>
      {error === undefined ? null : <p className={css.error} role="alert">{error}</p>}
      <div className={css.actions}>
        <Button variant="primary" className={css.primary} disabled={saving} onClick={onContinue}>
          {continueLabel}
        </Button>
      </div>
    </>
  )
}

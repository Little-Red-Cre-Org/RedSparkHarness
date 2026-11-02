/** Coded question failures shared by native and Cordis adapters. */
import { HarnessError } from '@redspark/rsh-errors'

/** Stable error taxonomy for user-questions failures. */
export class UserQuestionError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'UserQuestionError'
  }
}

/** Coded question failures shared by native and Cordis adapters. */
import { HarnessError } from '@deepseek-ai/dsh-errors'

/** Stable error taxonomy for user-questions failures. */
export class UserQuestionError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'UserQuestionError'
  }
}

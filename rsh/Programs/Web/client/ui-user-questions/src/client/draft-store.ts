/**
 * Session-scoped draft state for the generic question composer. The Slot
 * registry owns store instances; this module exports only the factory so a
 * plugin reload cannot reuse a module-global handle.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { QuestionDraftProgress } from '../question-presentation.ts'

export type { QuestionDraftAnswer, QuestionDraftProgress } from '../question-presentation.ts'

interface QuestionDraftState {
  requestKey?: string
  progress: QuestionDraftProgress
}

type QuestionDraftActions = {
  replace: (draft: QuestionDraftState, requestKey: string, progress: QuestionDraftProgress) => void
  clear: (draft: QuestionDraftState, requestKey: string) => void
}

const emptyProgress = (): QuestionDraftProgress => ({ index: 0, drafts: [] })

/**
 * Declare the question composer's transient Session store.
 * @returns a non-persisted store handle whose instance is owned by the Slot registry.
 */
export function createQuestionDraftStore(): EngineStoreHandle<QuestionDraftState, QuestionDraftActions> {
  return defineStore({
    init: (): QuestionDraftState => ({ progress: emptyProgress() }),
    actions: {
      replace: (draft, requestKey, progress) => {
        draft.requestKey = requestKey
        draft.progress = progress
      },
      clear: (draft, requestKey) => {
        if (draft.requestKey !== requestKey) return
        delete draft.requestKey
        draft.progress = emptyProgress()
      },
    },
  })
}

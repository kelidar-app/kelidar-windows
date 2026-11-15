import { create } from 'zustand'
import type { PromptAnswer, PromptRequest } from '@shared/session'
import { api } from '@renderer/lib/api'

/**
 * Questions from main waiting for the user, oldest first. The answers
 * (passwords included) are sent straight to main and never stored here.
 */
interface PromptsState {
  queue: PromptRequest[]
  answer: (promptId: string, answer: PromptAnswer) => void
}

export const usePromptsStore = create<PromptsState>()((set) => ({
  queue: [],
  answer: (promptId, answer) => {
    set((state) => ({ queue: state.queue.filter((item) => item.promptId !== promptId) }))
    void api.invoke('prompt:answer', { promptId, answer })
  },
}))

/** Call once at startup. Returns the unsubscribe function. */
export function subscribeToPrompts(): () => void {
  const offRequest = api.on('prompt:request', (request) => {
    usePromptsStore.setState((state) => ({ queue: [...state.queue, request] }))
  })
  const offCancel = api.on('prompt:cancel', ({ promptId }) => {
    usePromptsStore.setState((state) => ({
      queue: state.queue.filter((item) => item.promptId !== promptId),
    }))
  })
  return () => {
    offRequest()
    offCancel()
  }
}

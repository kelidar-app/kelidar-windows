import { randomBytes } from 'node:crypto'
import type { PromptAnswer, PromptRequest } from '@shared/session'
import type { EventSink } from './event-sink'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export type PromptQuestion = DistributiveOmit<PromptRequest, 'promptId'>

interface Pending {
  owner: EventSink
  sessionId: string
  kind: PromptRequest['kind']
  resolve: (answer: PromptAnswer | null) => void
}

/**
 * Questions main asks the user (trust this server key? password?). Each one
 * goes to the window that owns the session; only that window can answer, and
 * only with an answer of the same kind. Answers stay in main.
 */
export class PromptBroker {
  private readonly pending = new Map<string, Pending>()

  ask(owner: EventSink, question: PromptQuestion): Promise<PromptAnswer | null> {
    if (owner.isDestroyed()) return Promise.resolve(null)
    const promptId = randomBytes(16).toString('hex')
    return new Promise((resolve) => {
      this.pending.set(promptId, {
        owner,
        sessionId: question.sessionId,
        kind: question.kind,
        resolve,
      })
      owner.send('prompt:request', { ...question, promptId })
    })
  }

  /** Returns false when the prompt is unknown, belongs to another window or the kind differs. */
  answer(owner: EventSink, promptId: string, answer: PromptAnswer): boolean {
    const pending = this.pending.get(promptId)
    if (pending?.owner.id !== owner.id || pending.kind !== answer.kind) return false
    this.pending.delete(promptId)
    pending.resolve(answer)
    return true
  }

  /** Resolves open prompts of a session with null and closes their dialogs. */
  cancelSession(sessionId: string): void {
    for (const [promptId, pending] of this.pending) {
      if (pending.sessionId !== sessionId) continue
      this.pending.delete(promptId)
      pending.resolve(null)
      if (!pending.owner.isDestroyed()) pending.owner.send('prompt:cancel', { promptId })
    }
  }
}

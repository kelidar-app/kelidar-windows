import type { IpcEventPayload } from '@shared/ipc'
import type { IpcEvent } from '@shared/ipc-events'

/**
 * Where main sends events for one renderer (a WebContents in the app, a fake
 * in tests). Sessions and prompts belong to the sink that opened them.
 */
export interface EventSink {
  readonly id: number
  send<E extends IpcEvent>(event: E, payload: IpcEventPayload<E>): void
  isDestroyed(): boolean
}

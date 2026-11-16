import type { EventSink } from '../ssh/event-sink'
import type { KnownHosts } from '../ssh/host-keys'
import type { PromptBroker } from '../ssh/prompts'
import type { SessionManager } from '../ssh/session-manager'
import type { InvokeEventLike, IpcRouter } from './router'

export interface SessionHandlerDeps<E extends InvokeEventLike> {
  sessions: SessionManager
  prompts: PromptBroker
  knownHosts: Pick<KnownHosts, 'forget'>
  /** The window an invoke came from, as an event sink. */
  ownerOf: (event: E) => EventSink
}

/** No Electron imports here, so integration tests can drive the real handlers. */
export function registerSessionHandlers<E extends InvokeEventLike>(
  router: IpcRouter<E>,
  deps: SessionHandlerDeps<E>,
): void {
  const { sessions } = deps

  router.handle('session:open', (request, event) => sessions.open(deps.ownerOf(event), request))

  router.handle('session:input', ({ sessionId, data }, event) => {
    sessions.input(deps.ownerOf(event), sessionId, data)
    return undefined
  })

  router.handle('session:resize', ({ sessionId, cols, rows }, event) => {
    sessions.resize(deps.ownerOf(event), sessionId, cols, rows)
    return undefined
  })

  router.handle('session:ack', ({ sessionId, bytes }, event) => {
    sessions.ack(deps.ownerOf(event), sessionId, bytes)
    return undefined
  })

  router.handle('session:close', ({ sessionId }, event) => {
    sessions.close(deps.ownerOf(event), sessionId)
    return undefined
  })

  router.handle('session:duplicate', ({ sessionId, cols, rows }, event) =>
    sessions.duplicate(deps.ownerOf(event), sessionId, cols, rows),
  )

  router.handle('session:fillSudo', ({ sessionId }, event) => {
    sessions.fillSudo(deps.ownerOf(event), sessionId)
    return undefined
  })

  router.handle('session:reconnectNow', ({ sessionId }, event) => {
    sessions.reconnectNow(deps.ownerOf(event), sessionId)
    return undefined
  })

  router.handle('prompt:answer', ({ promptId, answer }, event) => {
    // Unknown or foreign prompt ids are ignored: the dialog may have been cancelled already.
    deps.prompts.answer(deps.ownerOf(event), promptId, answer)
    return undefined
  })

  router.handle('knownHosts:forget', async ({ host, port }) => {
    await deps.knownHosts.forget(host, port)
    return undefined
  })
}

import type { SessionStateEvent } from '@shared/session'
import { api } from './api'

type DataHandler = (data: Uint8Array) => void
type StateHandler = (event: SessionStateEvent) => void

const dataHandlers = new Map<string, DataHandler>()
/** Output that arrived before its terminal was mounted. */
const earlyData = new Map<string, Uint8Array[]>()
let stateHandler: StateHandler | null = null
let started = false

/**
 * One subscription for all sessions. Output is routed to the terminal that
 * owns the session; state changes go to the tabs store.
 */
export function startSessionEvents(onState: StateHandler): void {
  stateHandler = onState
  if (started) return
  started = true
  api.on('session:data', ({ sessionId, data }) => {
    const handler = dataHandlers.get(sessionId)
    if (handler !== undefined) {
      handler(data)
      return
    }
    const queue = earlyData.get(sessionId) ?? []
    queue.push(data)
    earlyData.set(sessionId, queue)
  })
  api.on('session:state', (event) => {
    stateHandler?.(event)
  })
}

/** Routes a session's output to `handler`, starting with anything already received. */
export function onSessionData(sessionId: string, handler: DataHandler): () => void {
  dataHandlers.set(sessionId, handler)
  const queued = earlyData.get(sessionId)
  earlyData.delete(sessionId)
  for (const data of queued ?? []) handler(data)
  return () => {
    if (dataHandlers.get(sessionId) === handler) dataHandlers.delete(sessionId)
  }
}

export function forgetSession(sessionId: string): void {
  dataHandlers.delete(sessionId)
  earlyData.delete(sessionId)
}

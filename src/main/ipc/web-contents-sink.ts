import type { WebContents } from 'electron'
import type { EventSink } from '../ssh/event-sink'

/**
 * One EventSink per WebContents. `onGone` runs when the page is destroyed or
 * loads again (a reload would otherwise leave its sessions running unseen).
 */
export function createSinkRegistry(onGone: (sink: EventSink) => void) {
  const sinks = new Map<number, EventSink>()
  return (contents: WebContents): EventSink => {
    const existing = sinks.get(contents.id)
    if (existing !== undefined) return existing
    const sink: EventSink = {
      id: contents.id,
      send: (event, payload) => {
        if (!contents.isDestroyed()) contents.send(event, payload)
      },
      isDestroyed: () => contents.isDestroyed(),
    }
    sinks.set(contents.id, sink)
    const gone = (): void => {
      sinks.delete(contents.id)
      onGone(sink)
    }
    contents.once('destroyed', gone)
    contents.once('did-navigate', gone)
    return sink
  }
}

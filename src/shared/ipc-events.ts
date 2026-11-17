/**
 * Event names main pushes to the renderer. No runtime dependencies, so the
 * sandboxed preload can import it. Payload types live in ipc.ts.
 */
export const IPC_EVENTS = [
  'session:data',
  'session:state',
  'session:sudo',
  'prompt:request',
  'prompt:cancel',
  'vault:state',
  'host:os',
] as const

export type IpcEvent = (typeof IPC_EVENTS)[number]

export function isIpcEvent(value: unknown): value is IpcEvent {
  return typeof value === 'string' && (IPC_EVENTS as readonly string[]).includes(value)
}

/**
 * Channel names only, with no runtime dependencies, so the sandboxed preload
 * can import it. The schemas for each channel live in ipc.ts.
 */
export const IPC_CHANNELS = [
  'app:getVersion',
  'settings:get',
  'settings:update',
  'window:setTitleBarOverlay',
] as const

export type IpcChannel = (typeof IPC_CHANNELS)[number]

export function isIpcChannel(value: unknown): value is IpcChannel {
  return typeof value === 'string' && (IPC_CHANNELS as readonly string[]).includes(value)
}

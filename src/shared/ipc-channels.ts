/**
 * Channel names only, with no runtime dependencies, so the sandboxed preload
 * can import it. The schemas for each channel live in ipc.ts.
 */
export const IPC_CHANNELS = [
  'agent:status',
  'app:getVersion',
  'clipboard:readText',
  'clipboard:writeText',
  'groups:list',
  'groups:save',
  'groups:delete',
  'hosts:list',
  'hosts:save',
  'hosts:delete',
  'hosts:setFavorite',
  'hosts:pickKeyFile',
  'hosts:upgradePrepare',
  'hosts:upgradeRun',
  'identities:list',
  'identities:save',
  'identities:delete',
  'keys:list',
  'keys:generate',
  'keys:import',
  'keys:rename',
  'keys:delete',
  'knownHosts:forget',
  'prompt:answer',
  'session:open',
  'session:input',
  'session:resize',
  'session:ack',
  'session:close',
  'settings:get',
  'settings:update',
  'window:setTitleBarOverlay',
] as const

export type IpcChannel = (typeof IPC_CHANNELS)[number]

export function isIpcChannel(value: unknown): value is IpcChannel {
  return typeof value === 'string' && (IPC_CHANNELS as readonly string[]).includes(value)
}

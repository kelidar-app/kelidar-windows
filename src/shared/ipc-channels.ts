/**
 * Channel names only, with no runtime dependencies, so the sandboxed preload
 * can import it. The schemas for each channel live in ipc.ts.
 */
export const IPC_CHANNELS = [
  'agent:status',
  'app:getVersion',
  'app:openExternal',
  'clipboard:readText',
  'clipboard:writeText',
  'data:export',
  'data:importPick',
  'data:import',
  'groups:list',
  'groups:save',
  'groups:delete',
  'groups:move',
  'hosts:list',
  'hosts:save',
  'hosts:delete',
  'hosts:setFavorite',
  'hosts:move',
  'hosts:pickKeyFile',
  'hosts:upgradePrepare',
  'hosts:upgradeRun',
  'import:scan',
  'import:apply',
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
  'secret:copy',
  'session:open',
  'session:input',
  'session:resize',
  'session:ack',
  'session:close',
  'session:duplicate',
  'session:reconnectNow',
  'session:fillSudo',
  'settings:get',
  'settings:update',
  'vault:status',
  'vault:unlock',
  'vault:lock',
  'vault:setMasterPassword',
  'vault:backups',
  'vault:restore',
  'window:setTitleBarOverlay',
] as const

export type IpcChannel = (typeof IPC_CHANNELS)[number]

export function isIpcChannel(value: unknown): value is IpcChannel {
  return typeof value === 'string' && (IPC_CHANNELS as readonly string[]).includes(value)
}

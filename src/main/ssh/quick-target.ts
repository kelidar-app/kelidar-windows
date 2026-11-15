import path from 'node:path'
import { formatTarget } from '@shared/address'
import { parseQuickConnect } from '@shared/quick-connect'
import { DEFAULT_SSH_PORT } from '@shared/records'
import { readKeyFile } from '../hosts/key-files'
import { AppError } from '../ipc/app-error'
import type { Credential } from './auth'
import type { ConnectTarget } from './session-manager'

/** ~ and relative paths are taken from the user's home folder. */
export function resolveIdentityPath(identityFile: string, homeDir: string): string {
  if (identityFile === '~') return homeDir
  if (identityFile.startsWith('~/') || identityFile.startsWith('~\\')) {
    return path.join(homeDir, identityFile.slice(2))
  }
  return path.isAbsolute(identityFile) ? identityFile : path.join(homeDir, identityFile)
}

/**
 * Builds a target from a Quick Connect string. Main parses the text itself
 * and never trusts the renderer's reading of it. Without -i the password is
 * asked for; an encrypted key's passphrase is asked for before connecting.
 */
export async function quickConnectTarget(input: string, homeDir: string): Promise<ConnectTarget> {
  const parsed = parseQuickConnect(input)
  if (!parsed.ok) throw new AppError('QUICK_CONNECT_INVALID')
  const { username, address, identityFile } = parsed.target
  const port = parsed.target.port ?? DEFAULT_SSH_PORT

  let credential: Credential = { type: 'ask' }
  if (identityFile !== undefined) {
    const file = await readKeyFile(resolveIdentityPath(identityFile, homeDir))
    credential = {
      type: 'key',
      privateKey: file.content,
      keyName: file.fileName,
      ...(file.encrypted ? { needsPassphrase: true } : {}),
    }
  }
  return { title: formatTarget({ username, address, port }), address, port, username, credential }
}

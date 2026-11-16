import { randomBytes } from 'node:crypto'
import net from 'node:net'
import { utils, type ParsedKey } from 'ssh2'

const SSH_AGENT_FAILURE = 5
const SSH_AGENTC_REQUEST_IDENTITIES = 11
const SSH_AGENT_IDENTITIES_ANSWER = 12
const SSH_AGENTC_SIGN_REQUEST = 13
const SSH_AGENT_SIGN_RESPONSE = 14

function sshString(data: Buffer | string): Buffer {
  const body = typeof data === 'string' ? Buffer.from(data) : data
  const length = Buffer.alloc(4)
  length.writeUInt32BE(body.length)
  return Buffer.concat([length, body])
}

function message(type: number, body: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(5)
  header.writeUInt32BE(body.length + 1)
  header[4] = type
  return Buffer.concat([header, body])
}

function readString(buffer: Buffer, offset: number): { value: Buffer; next: number } {
  const length = buffer.readUInt32BE(offset)
  return { value: buffer.subarray(offset + 4, offset + 4 + length), next: offset + 4 + length }
}

export interface TestAgent {
  /** A Windows named pipe, like \\.\pipe\openssh-ssh-agent. */
  pipe: string
  /** Sign requests answered so far. */
  signatures: () => number
  close: () => Promise<void>
}

/**
 * A minimal ssh-agent (list keys, sign) on a Windows named pipe, speaking the
 * same protocol as the Windows OpenSSH agent service. ed25519 keys only.
 */
export async function startTestAgent(privateKeys: string[]): Promise<TestAgent> {
  const keys: ParsedKey[] = privateKeys.map((text) => {
    const parsed = utils.parseKey(text)
    if (parsed instanceof Error || Array.isArray(parsed)) throw new Error('bad test key')
    return parsed
  })
  let signatures = 0
  const sockets = new Set<net.Socket>()

  const answer = (request: Buffer): Buffer => {
    const type = request[0]
    if (type === SSH_AGENTC_REQUEST_IDENTITIES) {
      const count = Buffer.alloc(4)
      count.writeUInt32BE(keys.length)
      const entries = keys.map((key) =>
        Buffer.concat([sshString(key.getPublicSSH()), sshString('test key')]),
      )
      return message(SSH_AGENT_IDENTITIES_ANSWER, Buffer.concat([count, ...entries]))
    }
    if (type === SSH_AGENTC_SIGN_REQUEST) {
      const blob = readString(request, 1)
      const data = readString(request, blob.next)
      const key = keys.find((item) => item.getPublicSSH().equals(blob.value))
      if (key === undefined) return message(SSH_AGENT_FAILURE)
      const signature = key.sign(data.value)
      if (signature instanceof Error) return message(SSH_AGENT_FAILURE)
      signatures++
      return message(
        SSH_AGENT_SIGN_RESPONSE,
        sshString(Buffer.concat([sshString(key.type), sshString(signature)])),
      )
    }
    return message(SSH_AGENT_FAILURE)
  }

  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => undefined)
    let buffer = Buffer.alloc(0)
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0)
        if (buffer.length < 4 + length) return
        const request = buffer.subarray(4, 4 + length)
        buffer = buffer.subarray(4 + length)
        socket.write(answer(request))
      }
    })
  })
  const pipe = `\\\\.\\pipe\\kelidar-test-agent-${randomBytes(8).toString('hex')}`
  await new Promise<void>((resolve) => {
    server.listen(pipe, resolve)
  })
  return {
    pipe,
    signatures: () => signatures,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => {
          resolve()
        })
      }),
  }
}

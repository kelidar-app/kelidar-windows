import { spawn, type ChildProcess } from 'node:child_process'
import { Duplex } from 'node:stream'
import { OpenSSHAgent, type BaseAgent } from 'ssh2'

/** The named pipe of the Windows OpenSSH agent service (ssh-agent). */
export const OPENSSH_AGENT_PIPE = '\\\\.\\pipe\\openssh-ssh-agent'

/** Exit codes of ssh2's pagent.exe helper. */
const PAGEANT_NOT_RUNNING = 11

/**
 * ssh2's helper that talks to Pageant. Inside the packaged app it sits in
 * app.asar.unpacked: Windows cannot run a program from inside app.asar.
 */
export function pagentExePath(appPath: string): string {
  const base = appPath.replace(/app\.asar$/, 'app.asar.unpacked')
  return `${base}\\node_modules\\ssh2\\util\\pagent.exe`
}

/**
 * One agent request through pagent.exe: the request goes to its stdin, the
 * answer comes from its stdout. Same protocol as ssh2's own Pageant socket,
 * but with a path that works in the packaged app.
 */
class PageantSocket extends Duplex {
  private buffer: Buffer = Buffer.alloc(0)
  private proc: ChildProcess | undefined

  constructor(private readonly exePath: string) {
    super()
  }

  override _read(): void {
    // Data is pushed when pagent.exe answers.
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error) => void): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    if (this.buffer.length < 4) {
      done()
      return
    }
    const length = this.buffer.readUInt32BE(0)
    if (this.buffer.length - 4 < length) {
      done()
      return
    }
    const request = this.buffer.subarray(0, 4 + length)
    this.buffer = this.buffer.subarray(4 + length)
    let failed = false
    const proc = spawn(this.exePath, [String(request.length)], { windowsHide: true })
    this.proc = proc
    proc.stdout.on('data', (data: Buffer) => {
      this.push(data)
    })
    proc.on('error', (error) => {
      failed = true
      done(error)
    })
    proc.on('close', (code) => {
      this.proc = undefined
      if (failed) return
      if (code === 0) done()
      else
        done(
          new Error(code === PAGEANT_NOT_RUNNING ? 'Pageant is not running' : 'pagent.exe failed'),
        )
    })
    proc.stdin.end(request)
  }

  override _destroy(error: Error | null, done: (error: Error | null) => void): void {
    this.proc?.kill()
    this.proc = undefined
    done(error)
  }
}

export class PageantAgent extends OpenSSHAgent {
  constructor(private readonly exePath: string) {
    super('pageant')
  }

  override getStream(cb: (error: Error | undefined, stream?: Duplex) => void): void {
    cb(undefined, new PageantSocket(this.exePath))
  }
}

/** The OpenSSH agent at a named pipe (the service's pipe unless a test passes another). */
export function openSshAgent(pipe: string = OPENSSH_AGENT_PIPE): BaseAgent {
  return new OpenSSHAgent(pipe)
}

/**
 * How many keys an agent offers, or null when it does not answer (not
 * running). Never returns the keys themselves.
 */
export function countAgentKeys(agent: BaseAgent, timeoutMs = 3000): Promise<number | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(null)
    }, timeoutMs)
    agent.getIdentities((error, keys) => {
      clearTimeout(timer)
      resolve(error === undefined || error === null ? (keys?.length ?? 0) : null)
    })
  })
}

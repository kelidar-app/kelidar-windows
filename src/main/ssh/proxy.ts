import net from 'node:net'
import type { ProxyType } from '@shared/records'
import { AppError } from '../ipc/app-error'

/** Main only: a proxy with its password. */
export interface ProxyConfig {
  type: ProxyType
  host: string
  port: number
  username?: string
  password?: string
}

const SOCKS_VERSION = 5
const AUTH_NONE = 0
const AUTH_USER_PASS = 2
const AUTH_NO_ACCEPTABLE = 0xff
const COMMAND_CONNECT = 1
const ADDRESS_IPV4 = 1
const ADDRESS_DOMAIN = 3
const ADDRESS_IPV6 = 4
const MAX_HEADER_BYTES = 16 * 1024

/**
 * Buffers what the proxy sends during the handshake. `take` waits until a
 * reply is complete; anything after it is handed back to the socket for SSH.
 */
class HandshakeReader {
  private buffer = Buffer.alloc(0)
  private waiter: (() => void) | undefined
  private error: Error | undefined

  constructor(private readonly socket: net.Socket) {
    socket.on('data', this.onData)
    socket.on('error', this.onError)
    socket.on('close', this.onClose)
  }

  private readonly onData = (chunk: Buffer): void => {
    this.buffer = Buffer.concat([this.buffer, chunk])
    this.waiter?.()
  }

  private readonly onError = (error: Error): void => {
    this.error = new AppError('PROXY_REFUSED', { cause: error })
    this.waiter?.()
  }

  private readonly onClose = (): void => {
    this.error ??= new AppError('PROXY_REFUSED')
    this.waiter?.()
  }

  /**
   * `measure` returns how many bytes the reply has once the buffer holds all
   * of it, or null to wait for more.
   */
  take(measure: (buffer: Buffer) => number | null): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const attempt = (): void => {
        const length = measure(this.buffer)
        if (length !== null && this.buffer.length >= length) {
          this.waiter = undefined
          const reply = this.buffer.subarray(0, length)
          this.buffer = this.buffer.subarray(length)
          resolve(reply)
        } else if (this.error !== undefined) {
          this.waiter = undefined
          reject(this.error)
        } else if (this.buffer.length > MAX_HEADER_BYTES) {
          this.waiter = undefined
          reject(new AppError('PROXY_REFUSED'))
        }
      }
      this.waiter = attempt
      attempt()
    })
  }

  bytes(count: number): Promise<Buffer> {
    return this.take(() => count)
  }

  release(): void {
    this.socket.removeListener('data', this.onData)
    this.socket.removeListener('error', this.onError)
    this.socket.removeListener('close', this.onClose)
    if (this.buffer.length > 0) this.socket.unshift(this.buffer)
  }
}

function connectToProxy(proxy: ProxyConfig, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.host, port: proxy.port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new AppError('PROXY_UNREACHABLE'))
    }, timeoutMs)
    socket.once('connect', () => {
      clearTimeout(timer)
      resolve(socket)
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(new AppError('PROXY_UNREACHABLE', { cause: error }))
    })
  })
}

/** "2001:db8::1" as 16 bytes. */
export function ipv6Bytes(address: string): Buffer {
  const [head = '', tail = ''] = (address.split('%')[0] ?? address).split('::')
  const left = head === '' ? [] : head.split(':')
  const right = tail === '' ? [] : tail.split(':')
  const groups = [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right]
  const bytes = Buffer.alloc(16)
  groups.forEach((group, index) => {
    bytes.writeUInt16BE(parseInt(group, 16), index * 2)
  })
  return bytes
}

function socksAddress(host: string): Buffer {
  const kind = net.isIP(host.split('%')[0] ?? host)
  if (kind === 4) return Buffer.from([ADDRESS_IPV4, ...host.split('.').map(Number)])
  if (kind === 6) return Buffer.concat([Buffer.from([ADDRESS_IPV6]), ipv6Bytes(host)])
  const name = Buffer.from(host, 'utf8')
  if (name.length > 255) throw new AppError('PROXY_REFUSED')
  return Buffer.concat([Buffer.from([ADDRESS_DOMAIN, name.length]), name])
}

/** Length of a SOCKS5 connect reply, once its address type is known. */
function socksReplyLength(buffer: Buffer): number | null {
  if (buffer.length < 5) return null
  const type = buffer[3]
  if (type === ADDRESS_IPV4) return 4 + 4 + 2
  if (type === ADDRESS_IPV6) return 4 + 16 + 2
  if (type === ADDRESS_DOMAIN) return 4 + 1 + (buffer[4] ?? 0) + 2
  return 4
}

async function socks5(socket: net.Socket, proxy: ProxyConfig, host: string, port: number) {
  const reader = new HandshakeReader(socket)
  const withPassword = proxy.username !== undefined
  socket.write(
    Buffer.from(
      withPassword ? [SOCKS_VERSION, 2, AUTH_NONE, AUTH_USER_PASS] : [SOCKS_VERSION, 1, AUTH_NONE],
    ),
  )
  const [version, method] = await reader.bytes(2)
  if (version !== SOCKS_VERSION) throw new AppError('PROXY_REFUSED')
  if (method === AUTH_NO_ACCEPTABLE) throw new AppError('PROXY_AUTH_FAILED')
  if (method === AUTH_USER_PASS) {
    const user = Buffer.from(proxy.username ?? '', 'utf8')
    const pass = Buffer.from(proxy.password ?? '', 'utf8')
    if (user.length > 255 || pass.length > 255) throw new AppError('PROXY_AUTH_FAILED')
    socket.write(
      Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([pass.length]), pass]),
    )
    const [, status] = await reader.bytes(2)
    if (status !== 0) throw new AppError('PROXY_AUTH_FAILED')
  } else if (method !== AUTH_NONE) {
    throw new AppError('PROXY_REFUSED')
  }
  const portBytes = Buffer.alloc(2)
  portBytes.writeUInt16BE(port)
  socket.write(
    Buffer.concat([
      Buffer.from([SOCKS_VERSION, COMMAND_CONNECT, 0]),
      socksAddress(host),
      portBytes,
    ]),
  )
  const reply = await reader.take(socksReplyLength)
  if (reply[0] !== SOCKS_VERSION || reply[1] !== 0) throw new AppError('PROXY_REFUSED')
  reader.release()
}

async function httpConnect(socket: net.Socket, proxy: ProxyConfig, host: string, port: number) {
  const reader = new HandshakeReader(socket)
  const authority = net.isIPv6(host) ? `[${host}]:${String(port)}` : `${host}:${String(port)}`
  const lines = [`CONNECT ${authority} HTTP/1.1`, `Host: ${authority}`]
  if (proxy.username !== undefined) {
    const token = Buffer.from(`${proxy.username}:${proxy.password ?? ''}`, 'utf8').toString(
      'base64',
    )
    lines.push(`Proxy-Authorization: Basic ${token}`)
  }
  socket.write(`${lines.join('\r\n')}\r\n\r\n`)
  const head = await reader.take((buffer) => {
    const end = buffer.indexOf('\r\n\r\n')
    return end === -1 ? null : end + 4
  })
  const status = /^HTTP\/1\.[01] (\d{3})/.exec(head.toString('latin1'))?.[1]
  if (status === '407') throw new AppError('PROXY_AUTH_FAILED')
  if (status === undefined || !status.startsWith('2')) throw new AppError('PROXY_REFUSED')
  reader.release()
}

/**
 * A TCP connection to host:port through a SOCKS5 or HTTP proxy, ready to hand
 * to ssh2 as its `sock`. The proxy resolves the host name (no local DNS lookup).
 */
export async function openProxySocket(
  proxy: ProxyConfig,
  host: string,
  port: number,
  timeoutMs: number,
): Promise<net.Socket> {
  const socket = await connectToProxy(proxy, timeoutMs)
  const timer = setTimeout(() => {
    socket.destroy()
  }, timeoutMs)
  try {
    if (proxy.type === 'socks5') await socks5(socket, proxy, host, port)
    else await httpConnect(socket, proxy, host, port)
    return socket
  } catch (error) {
    socket.destroy()
    throw error instanceof AppError ? error : new AppError('PROXY_REFUSED', { cause: error })
  } finally {
    clearTimeout(timer)
  }
}

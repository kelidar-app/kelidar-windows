import net from 'node:net'

export interface TestProxy {
  port: number
  /** Where clients asked to go, as host:port. */
  targets: string[]
  close: () => Promise<void>
}

function pipeTo(client: net.Socket, host: string, port: number, ready: () => void): void {
  const upstream = net.connect(port, host, ready)
  upstream.on('error', () => client.destroy())
  client.on('error', () => upstream.destroy())
  client.pipe(upstream).pipe(client)
}

async function listen(
  server: net.Server,
  sockets: Set<net.Socket>,
  targets: string[],
): Promise<TestProxy> {
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return {
    port: address.port,
    targets,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => {
          resolve()
        })
      }),
  }
}

/** A SOCKS5 proxy (RFC 1928/1929) with optional user name and password. */
export function startSocksProxy(auth?: { username: string; password: string }): Promise<TestProxy> {
  const targets: string[] = []
  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    let stage: 'greeting' | 'auth' | 'request' = 'greeting'
    let buffer = Buffer.alloc(0)
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk])
      if (stage === 'greeting') {
        if (buffer.length < 2 || buffer.length < 2 + (buffer[1] ?? 0)) return
        const methods = [...buffer.subarray(2, 2 + (buffer[1] ?? 0))]
        buffer = buffer.subarray(2 + (buffer[1] ?? 0))
        const wanted = auth === undefined ? 0 : 2
        if (!methods.includes(wanted)) {
          socket.end(Buffer.from([5, 0xff]))
          return
        }
        socket.write(Buffer.from([5, wanted]))
        stage = auth === undefined ? 'request' : 'auth'
      }
      if (stage === 'auth') {
        const userLength = buffer[1] ?? 0
        const passLength = buffer[2 + userLength]
        if (passLength === undefined || buffer.length < 3 + userLength + passLength) return
        const user = buffer.subarray(2, 2 + userLength).toString()
        const pass = buffer.subarray(3 + userLength, 3 + userLength + passLength).toString()
        buffer = buffer.subarray(3 + userLength + passLength)
        const ok = user === auth?.username && pass === auth.password
        socket.write(Buffer.from([1, ok ? 0 : 1]))
        if (!ok) {
          socket.end()
          return
        }
        stage = 'request'
      }
      {
        if (buffer.length < 5) return
        const type = buffer[3]
        let host: string
        let end: number
        if (type === 1) {
          end = 4 + 4
          host = [...buffer.subarray(4, 8)].join('.')
        } else if (type === 3) {
          const length = buffer[4] ?? 0
          end = 5 + length
          host = buffer.subarray(5, end).toString()
        } else {
          socket.end(Buffer.from([5, 8, 0, 1, 0, 0, 0, 0, 0, 0]))
          return
        }
        if (buffer.length < end + 2) return
        const port = buffer.readUInt16BE(end)
        targets.push(`${host}:${String(port)}`)
        socket.removeListener('data', onData)
        const rest = buffer.subarray(end + 2)
        pipeTo(socket, host, port, () => {
          socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
          if (rest.length > 0) socket.unshift(rest)
        })
      }
    }
    socket.on('data', onData)
    socket.on('error', () => undefined)
  })
  return listen(server, sockets, targets)
}

/** An HTTP CONNECT proxy with optional Basic authentication. */
export function startHttpProxy(auth?: { username: string; password: string }): Promise<TestProxy> {
  const targets: string[] = []
  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0)
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk])
      const end = buffer.indexOf('\r\n\r\n')
      if (end === -1) return
      socket.removeListener('data', onData)
      const head = buffer.subarray(0, end).toString('latin1')
      const rest = buffer.subarray(end + 4)
      const target = /^CONNECT (\S+):(\d+) HTTP\/1\.1/.exec(head)
      if (target?.[1] === undefined || target[2] === undefined) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
        return
      }
      if (auth !== undefined) {
        const expected = Buffer.from(`${auth.username}:${auth.password}`).toString('base64')
        if (!head.includes(`Proxy-Authorization: Basic ${expected}`)) {
          socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n')
          return
        }
      }
      const host = target[1]
      const port = Number(target[2])
      targets.push(`${host}:${String(port)}`)
      pipeTo(socket, host, port, () => {
        socket.write('HTTP/1.1 200 Connection established\r\n\r\n')
        if (rest.length > 0) socket.unshift(rest)
      })
    }
    socket.on('data', onData)
    socket.on('error', () => undefined)
  })
  return listen(server, sockets, targets)
}

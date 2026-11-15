import { readFile } from 'node:fs/promises'
import { protocol } from 'electron'
import { APP } from '@shared/app'
import { PRODUCTION_CSP } from './csp'
import { mimeTypeFor, resolveRendererPath } from './renderer-path'

/** Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP.protocolScheme,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
    },
  ])
}

const SECURITY_HEADERS = {
  'Content-Security-Policy': PRODUCTION_CSP,
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
}

/** Serves the built renderer from app://<host>/ with a strict CSP on every response. */
export function handleAppProtocol(rendererDir: string): void {
  protocol.handle(APP.protocolScheme, async (request) => {
    const url = new URL(request.url)
    if (url.host !== APP.protocolHost || request.method !== 'GET') {
      return new Response(null, { status: 404, headers: SECURITY_HEADERS })
    }
    const filePath = resolveRendererPath(rendererDir, url.pathname)
    if (filePath === null) {
      return new Response(null, { status: 404, headers: SECURITY_HEADERS })
    }
    try {
      const body = await readFile(filePath)
      return new Response(body, {
        status: 200,
        headers: { ...SECURITY_HEADERS, 'Content-Type': mimeTypeFor(filePath) },
      })
    } catch {
      return new Response(null, { status: 404, headers: SECURITY_HEADERS })
    }
  })
}

import { createHash } from 'node:crypto'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createOriginMatcher, createSenderCheck, originOf } from '../../src/main/ipc/sender'
import { developmentCsp, EMPTY_STYLE_HASH, PRODUCTION_CSP } from '../../src/main/security/csp'
import { isSafeExternalUrl } from '../../src/main/security/external-url'
import { mimeTypeFor, resolveRendererPath } from '../../src/main/security/renderer-path'

describe('originOf', () => {
  it('keeps custom schemes that URL.origin reports as "null"', () => {
    expect(originOf('app://kelidar/index.html')).toBe('app://kelidar')
    expect(originOf('http://localhost:5173/')).toBe('http://localhost:5173')
    expect(originOf('about:blank')).toBeNull()
    expect(originOf('not a url')).toBeNull()
  })
})

describe('sender check', () => {
  const check = createSenderCheck(['app://kelidar'])
  it('accepts only top-level frames from allowed origins', () => {
    expect(check({ url: 'app://kelidar/index.html', parent: null })).toBe(true)
    expect(check({ url: 'app://KELIDAR/index.html', parent: null })).toBe(true)
    expect(check({ url: 'app://other/index.html', parent: null })).toBe(false)
    expect(check({ url: 'app://kelidar.evil/index.html', parent: null })).toBe(false)
    expect(check({ url: 'app://kelidar/index.html', parent: {} })).toBe(false)
    expect(check(null)).toBe(false)
  })
})

describe('createOriginMatcher', () => {
  const isAppUrl = createOriginMatcher(['app://kelidar', 'http://localhost:5173'])
  it('matches only our own origins', () => {
    expect(isAppUrl('app://kelidar/index.html')).toBe(true)
    expect(isAppUrl('http://localhost:5173/')).toBe(true)
    expect(isAppUrl('about:blank')).toBe(false)
    expect(isAppUrl('http://localhost:5174/')).toBe(false)
    expect(isAppUrl('https://example.com/')).toBe(false)
  })
})

describe('isSafeExternalUrl', () => {
  it('allows plain http and https links', () => {
    expect(isSafeExternalUrl('https://github.com/kelidar-app/kelidar-windows')).toBe(true)
    expect(isSafeExternalUrl('http://example.com/a?b=c')).toBe(true)
  })

  it('refuses every other scheme, credentials and junk', () => {
    for (const url of [
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'ms-settings:privacy',
      'smb://server/share',
      '\\\\server\\share',
      'https://user:pass@example.com',
      'https://user@example.com',
      'about:blank',
      'not a url',
      `https://example.com/${'a'.repeat(3000)}`,
    ]) {
      expect(isSafeExternalUrl(url), url).toBe(false)
    }
  })
})

describe('resolveRendererPath', () => {
  const root = path.resolve('out/renderer')

  it('maps app:// paths inside the renderer folder', () => {
    expect(resolveRendererPath(root, '/')).toBe(path.join(root, 'index.html'))
    expect(resolveRendererPath(root, '/index.html')).toBe(path.join(root, 'index.html'))
    expect(resolveRendererPath(root, '/assets/app%20x.js')).toBe(
      path.join(root, 'assets', 'app x.js'),
    )
  })

  it('refuses paths that escape the folder', () => {
    for (const pathname of [
      '/../package.json',
      '/assets/../../main/index.js',
      '/%2e%2e/%2e%2e/secret',
      '/..%2F..%2Fsecret',
      '/assets%5C..%5C..%5Csecret',
      '/%00index.html',
      '/%E0%A4%A',
    ]) {
      expect(resolveRendererPath(root, pathname), pathname).toBeNull()
    }
  })

  it('serves known types with the right MIME type', () => {
    expect(mimeTypeFor('a/index.html')).toBe('text/html; charset=utf-8')
    expect(mimeTypeFor('a/x.WOFF2')).toBe('font/woff2')
    expect(mimeTypeFor('a/x.exe')).toBe('application/octet-stream')
  })
})

describe('Content Security Policy', () => {
  it('allows nothing inline or remote in production', () => {
    expect(PRODUCTION_CSP).toContain("default-src 'none'")
    expect(PRODUCTION_CSP).toContain("script-src 'self'")
    expect(PRODUCTION_CSP).toContain("object-src 'none'")
    expect(PRODUCTION_CSP).not.toMatch(/unsafe-inline|unsafe-eval|https?:|data:|\*/)
  })

  it('allows only the empty inline style, by hash', () => {
    const emptyHash = createHash('sha256').update('').digest('base64')
    expect(EMPTY_STYLE_HASH).toBe(`'sha256-${emptyHash}'`)
    expect(PRODUCTION_CSP.match(/'sha256-[^']+'/g)).toEqual([EMPTY_STYLE_HASH])
    expect(PRODUCTION_CSP).not.toContain('unsafe-hashes')
  })

  it('limits the development policy to the dev server', () => {
    const csp = developmentCsp('http://localhost:5173')
    expect(csp).toContain('ws://localhost:5173')
    expect(csp).not.toContain('unsafe-eval')
  })
})

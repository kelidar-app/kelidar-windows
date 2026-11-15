/**
 * Content Security Policy for the packaged renderer (served from app://).
 * No inline scripts or styles, no remote content, no plugins, no framing.
 */
export const PRODUCTION_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ')

/**
 * Development only (npm run dev): the Vite dev server needs inline styles,
 * the React Refresh preamble and a WebSocket for hot reload. Never used in a
 * packaged build.
 */
export function developmentCsp(devServerOrigin: string): string {
  const ws = devServerOrigin.replace(/^http/, 'ws')
  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline'`,
    `style-src 'self' 'unsafe-inline'`,
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${ws}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ')
}

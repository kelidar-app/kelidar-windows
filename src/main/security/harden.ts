import { app, session, shell, type Session } from 'electron'
import { developmentCsp } from './csp'
import { isSafeExternalUrl } from './external-url'

export function openExternalSafely(url: string): void {
  if (isSafeExternalUrl(url)) {
    void shell.openExternal(url)
  }
}

export interface NavigationPolicy {
  /** True for URLs of our own renderer (app://, or the dev server in development). */
  isAppUrl: (url: string) => boolean
  /** Where to send a window that somehow left the app. */
  homeUrl: string
}

/**
 * Applies to every webContents the app ever creates:
 * no navigation, no redirects, no new windows, no <webview>.
 * Links with target=_blank open in the default browser when they are http(s).
 */
export function denyNavigationAndPopups(policy: NavigationPolicy): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event) => {
      event.preventDefault()
    })
    // Chromium commits about:blank (and similar) inside the renderer without
    // emitting will-navigate. If the main frame ever lands outside the app,
    // load the app again, so navigating away is still denied.
    contents.on('did-navigate', (_navEvent, url) => {
      if (!policy.isAppUrl(url)) {
        void contents.loadURL(policy.homeUrl)
      }
    })
    contents.on('will-redirect', (event) => {
      event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
    })
    contents.setWindowOpenHandler(({ url }) => {
      openExternalSafely(url)
      return { action: 'deny' }
    })
  })
}

/** Deny every permission (camera, notifications, clipboard-read, ...) until a feature needs one. */
export function denyAllPermissions(target: Session = session.defaultSession): void {
  target.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })
  target.setPermissionCheckHandler(() => false)
  target.setDevicePermissionHandler(() => false)
}

/** Development only: add a CSP header to responses from the Vite dev server. */
export function applyDevelopmentCsp(
  devServerUrl: string,
  target: Session = session.defaultSession,
): void {
  const origin = new URL(devServerUrl).origin
  const csp = developmentCsp(origin)
  target.webRequest.onHeadersReceived({ urls: [`${origin}/*`] }, (details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
    })
  })
}

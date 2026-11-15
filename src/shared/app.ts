/**
 * Product identity. The product name is defined here and nowhere else
 * (AGENTS.md, architecture rule 9). Build tooling imports this file too.
 */
export const APP = {
  name: 'Kelidar',
  id: 'io.github.kelidar-app.kelidar-windows',
  protocolScheme: 'app',
  protocolHost: 'kelidar',
  repository: {
    owner: 'kelidar-app',
    name: 'kelidar-windows',
    url: 'https://github.com/kelidar-app/kelidar-windows',
  },
} as const

/** Origin the packaged renderer is served from, e.g. app://kelidar */
export const APP_ORIGIN = `${APP.protocolScheme}://${APP.protocolHost}`

/** Height of the custom title bar in CSS pixels; main uses it for the window controls overlay. */
export const TITLE_BAR_HEIGHT = 40

import path from 'node:path'
import { app } from 'electron'
import { APP } from '@shared/app'

/** Development and tests only: point userData somewhere else. Ignored in a packaged build. */
export const USER_DATA_OVERRIDE_ENV = `${APP.name.toUpperCase()}_USER_DATA_DIR`

/**
 * Must run before anything reads userData, including the single-instance lock.
 * userData is %APPDATA%\<product name>.
 */
export function configureAppPaths(): void {
  app.setName(APP.name)
  const override = app.isPackaged ? undefined : process.env[USER_DATA_OVERRIDE_ENV]
  const userData =
    override !== undefined && path.isAbsolute(override)
      ? override
      : path.join(app.getPath('appData'), APP.name)
  app.setPath('userData', userData)
}

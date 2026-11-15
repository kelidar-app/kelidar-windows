/** The parts of Electron's WebFrameMain the sender check needs. */
export interface FrameLike {
  readonly url: string
  readonly parent: unknown
}

/**
 * `scheme://host[:port]` of a URL, or null when it cannot be parsed.
 * Node's URL gives custom schemes an opaque origin ("null"), so build it by hand.
 */
export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.host === '') return null
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return null
  }
}

/**
 * A sender is trusted only when it is a top-level frame (not an iframe)
 * whose document comes from one of our own origins.
 */
export function createSenderCheck(allowedOrigins: readonly string[]) {
  const isAllowedUrl = createOriginMatcher(allowedOrigins)
  return (frame: FrameLike | null | undefined): boolean => {
    if (frame == null || frame.parent != null) return false
    return isAllowedUrl(frame.url)
  }
}

/** True when a URL belongs to one of the allowed origins. */
export function createOriginMatcher(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins.map((origin) => origin.toLowerCase()))
  return (url: string): boolean => {
    const origin = originOf(url)
    return origin !== null && allowed.has(origin.toLowerCase())
  }
}

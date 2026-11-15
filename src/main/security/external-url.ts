/**
 * Only plain http and https links may leave the app, and never with
 * credentials in them. Everything else (file:, javascript:, custom schemes,
 * UNC paths) is refused.
 */
export function isSafeExternalUrl(url: string): boolean {
  if (url.length > 2048) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (parsed.username !== '' || parsed.password !== '') return false
  return parsed.hostname !== ''
}

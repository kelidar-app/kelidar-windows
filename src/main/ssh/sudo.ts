/** Terminal escape sequences (colors, cursor moves, titles), removed before matching. */
const ESCAPES =
  // eslint-disable-next-line no-control-regex -- matching escape sequences is the point
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|[\x00-\x08\x0b\x0c\x0e-\x1f]/g

/** How much recent output to keep per session for the check. */
export const SUDO_TAIL_BYTES = 512

const PROMPTS = [
  /^\[sudo\] password for [^:]{1,64}:$/i,
  /^\[sudo: authenticate\] password:$/i,
  /^doas \([^)]{1,128}\) password:$/i,
  /^password:$/i,
]

/**
 * True when the last line of the output is a password prompt from sudo (or
 * doas), waiting for input. Only then may Kelidar type the saved password,
 * and only when the user presses the hotkey.
 */
export function looksLikeSudoPrompt(tail: string): boolean {
  const text = tail.replace(ESCAPES, '').replace(/\r\n?/g, '\n')
  const last = (text.split('\n').at(-1) ?? '').trim()
  if (last.length === 0 || last.length > 160) return false
  return PROMPTS.some((prompt) => prompt.test(last))
}

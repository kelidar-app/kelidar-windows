/**
 * A small fuzzy matcher for the host search and the command palette.
 * The query's characters must appear in the text in order; matches at word
 * starts and runs of consecutive characters score higher, and a plain
 * substring beats a scattered match. No dependency: the lists are small.
 */

/** Lower case, and the Arabic forms of ی and ک that Windows keyboards may type. */
export function foldText(text: string): string {
  return text.toLocaleLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک').normalize('NFC')
}

const SEPARATORS = new Set([' ', '.', '-', '_', '@', ':', '/', '\\', '(', ')', '[', ']', ','])

function isWordStart(chars: readonly string[], index: number): boolean {
  if (index === 0) return true
  const previous = chars[index - 1]
  return previous !== undefined && SEPARATORS.has(previous)
}

/** Score for `query` in `text`, or null when it does not match. Higher is better. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = Array.from(foldText(query.trim()))
  if (q.length === 0) return 0
  const folded = foldText(text)
  const t = Array.from(folded)
  if (q.length > t.length) return null

  const substring = folded.indexOf(q.join(''))
  if (substring !== -1) {
    const index = Array.from(folded.slice(0, substring)).length
    let score = 100 + q.length * 4 - Math.min(index, 20)
    if (index === 0) score += 40
    else if (isWordStart(t, index)) score += 20
    if (q.length === t.length) score += 40
    return score
  }

  let score = 0
  let from = 0
  let previous = -2
  for (const char of q) {
    let found = -1
    for (let i = from; i < t.length; i++) {
      if (t[i] === char) {
        found = i
        break
      }
    }
    if (found === -1) return null
    score += 1
    if (found === previous + 1) score += 4
    if (isWordStart(t, found)) score += 6
    previous = found
    from = found + 1
  }
  // Shorter texts with the same match read as closer.
  return score - Math.min(t.length - q.length, 30) * 0.05
}

/** The best score of `query` over several texts, each with a weight. */
export function bestScore(
  query: string,
  fields: readonly (readonly [text: string, weight: number])[],
): number | null {
  let best: number | null = null
  for (const [text, weight] of fields) {
    const score = fuzzyScore(query, text)
    if (score !== null && (best === null || score * weight > best)) best = score * weight
  }
  return best
}

/** Splits a query into words. */
export function queryTerms(query: string): string[] {
  return query.split(/\s+/u).filter((term) => term !== '')
}

/**
 * The command palette's ranking: every word must match one of the keywords.
 * Returns a number between 0 (hidden) and 1, as cmdk expects.
 */
export function scoreKeywords(search: string, keywords: readonly string[]): number {
  const fields = keywords.map((keyword) => [keyword, 1] as const)
  let total = 0
  for (const term of queryTerms(search)) {
    const score = bestScore(term, fields)
    if (score === null) return 0
    total += Math.max(score, 0.5)
  }
  return total / (total + 100)
}

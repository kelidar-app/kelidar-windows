import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import en from '../../src/renderer/i18n/en.json'
import fa from '../../src/renderer/i18n/fa.json'
import { ERROR_CODES } from '../../src/shared/errors'

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, value] of Object.entries(tree)) {
    const full = prefix === '' ? key : `${prefix}.${key}`
    if (typeof value === 'string') out.set(full, value)
    else for (const [k, v] of flatten(value, full)) out.set(k, v)
  }
  return out
}

const placeholders = (text: string): string[] =>
  [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1] ?? '').sort()

describe('translations', () => {
  const enKeys = flatten(en)
  const faKeys = flatten(fa)

  it('have the same keys in English and Persian', () => {
    expect([...faKeys.keys()].sort()).toEqual([...enKeys.keys()].sort())
  })

  it('have no empty strings and the same placeholders', () => {
    for (const [key, text] of enKeys) {
      const persian = faKeys.get(key) ?? ''
      expect(text.trim(), key).not.toBe('')
      expect(persian.trim(), key).not.toBe('')
      expect(placeholders(persian), key).toEqual(placeholders(text))
    }
  })

  it('translate every error code', () => {
    for (const code of ERROR_CODES) {
      expect(enKeys.has(`errors.${code}`), code).toBe(true)
    }
  })
})

/**
 * Right-to-left check: the renderer must use logical properties so the
 * layout mirrors for Persian. Physical left/right utilities are refused.
 */
const PHYSICAL_CLASS =
  /(?<![\w-])-?(?:m[lr]|p[lr]|left|right|border-[lr]|rounded-[lr]|rounded-(?:tl|tr|bl|br)|scroll-[mp][lr]|text-(?:left|right)|float-(?:left|right)|clear-(?:left|right))(?:-|(?=["'\s`]))/
const PHYSICAL_CSS =
  /(?:^|[\s;{])(?:margin|padding|border)-(?:left|right)\b|(?:^|[\s;{])(?:left|right)\s*:|text-align\s*:\s*(?:left|right)|float\s*:\s*(?:left|right)/

async function filesUnder(dir: string, extensions: string[]): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && extensions.includes(path.extname(entry.name)))
    .map((entry) => path.join(entry.parentPath, entry.name))
}

describe('right-to-left layout', () => {
  const rendererDir = path.resolve('src/renderer')

  it('uses no physical left/right utility classes in components', async () => {
    const problems: string[] = []
    for (const file of await filesUnder(rendererDir, ['.tsx', '.ts'])) {
      const text = await readFile(file, 'utf8')
      // A file may opt out, with a reason, when left and right are physical on purpose.
      if (/^\/\/ rtl-exempt-file: \S/m.test(text.split('\n').slice(0, 3).join('\n'))) continue
      const lines = text.split('\n')
      lines.forEach((line, index) => {
        if (PHYSICAL_CLASS.test(line))
          problems.push(`${path.relative(rendererDir, file)}:${String(index + 1)}: ${line.trim()}`)
      })
    }
    expect(problems).toEqual([])
  })

  it('uses no physical left/right CSS properties outside rtl-exempt blocks', async () => {
    const problems: string[] = []
    for (const file of await filesUnder(rendererDir, ['.css'])) {
      const text = await readFile(file, 'utf8')
      // Drop rules introduced by an "rtl-exempt" comment (comment and the rule after it).
      const checked = text.replace(
        /\/\*(?:(?!\*\/)[\s\S])*?rtl-exempt[\s\S]*?\*\/\s*[^{}]+\{[^}]*\}/g,
        '',
      )
      checked.split('\n').forEach((line, index) => {
        if (PHYSICAL_CSS.test(line))
          problems.push(`${path.relative(rendererDir, file)}:${String(index + 1)}: ${line.trim()}`)
      })
    }
    expect(problems).toEqual([])
  })

  it('catches physical classes (self-test)', () => {
    expect(PHYSICAL_CLASS.test('className="ml-2"')).toBe(true)
    expect(PHYSICAL_CLASS.test('className="pr-4 flex"')).toBe(true)
    expect(PHYSICAL_CLASS.test('className="text-left"')).toBe(true)
    expect(PHYSICAL_CLASS.test('className="border-r"')).toBe(true)
    expect(PHYSICAL_CLASS.test('className="ms-2 pe-4 text-start border-e"')).toBe(false)
    expect(PHYSICAL_CLASS.test('className="rounded-t-md"')).toBe(false)
  })
})

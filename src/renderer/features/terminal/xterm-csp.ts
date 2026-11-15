/**
 * xterm.js writes some of its CSS (scrollbar, cell sizes, theme colors) into
 * <style> elements it creates inside the terminal. Our Content Security Policy
 * blocks inline styles (style-src 'self'), and we keep it that way. Instead,
 * text written to a <style> element inside an .xterm container is moved into
 * a constructed stylesheet (document.adoptedStyleSheets), which CSP allows
 * because it is not markup. Other style elements are not touched.
 */
const sheets = new WeakMap<HTMLStyleElement, CSSStyleSheet>()
let installed = false

export function installXtermStyleShim(): void {
  if (installed) return
  installed = true

  // The original accessors, called with the style element as receiver.
  const getText = (element: HTMLStyleElement): string | null =>
    Reflect.get<object, 'textContent'>(Node.prototype, 'textContent', element) as string | null
  const setText = (element: HTMLStyleElement, value: string | null): void => {
    Reflect.set(Node.prototype, 'textContent', value, element)
  }

  const isXtermStyle = (element: HTMLStyleElement): boolean =>
    sheets.has(element) || element.closest('.xterm') !== null

  Object.defineProperty(HTMLStyleElement.prototype, 'textContent', {
    configurable: true,
    get(this: HTMLStyleElement): string | null {
      const sheet = sheets.get(this)
      if (sheet === undefined) return getText(this)
      return Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n')
    },
    set(this: HTMLStyleElement, value: string | null) {
      if (!isXtermStyle(this)) {
        setText(this, value)
        return
      }
      let sheet = sheets.get(this)
      if (sheet === undefined) {
        sheet = new CSSStyleSheet()
        sheets.set(this, sheet)
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
      }
      sheet.replaceSync(value ?? '')
    },
  })

  Object.defineProperty(HTMLStyleElement.prototype, 'remove', {
    configurable: true,
    value(this: HTMLStyleElement) {
      const sheet = sheets.get(this)
      if (sheet !== undefined) {
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((item) => item !== sheet)
        sheets.delete(this)
      }
      Element.prototype.remove.call(this)
    },
  })
}

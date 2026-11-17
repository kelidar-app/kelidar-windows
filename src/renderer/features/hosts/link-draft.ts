import { isSafeExternalUrl, type HostLink } from '@shared/host-extras'

/** The links in the host form, as typed. */
export interface LinkDraft {
  title: string
  url: string
}

export function initialLinks(links: readonly HostLink[] | undefined): LinkDraft[] {
  return (links ?? []).map((link) => ({ title: link.title ?? '', url: link.url }))
}

/**
 * The links to save, or the rows whose address is not a web address.
 * Empty rows are dropped.
 */
export function linksRequest(
  drafts: readonly LinkDraft[],
): { ok: true; links: HostLink[] } | { ok: false; invalid: Set<number> } {
  const invalid = new Set<number>()
  const links: HostLink[] = []
  drafts.forEach((draft, index) => {
    const url = draft.url.trim()
    const title = draft.title.trim()
    if (url === '' && title === '') return
    if (!isSafeExternalUrl(url)) {
      invalid.add(index)
      return
    }
    links.push({ url, ...(title === '' ? {} : { title }) })
  })
  return invalid.size === 0 ? { ok: true, links } : { ok: false, invalid }
}

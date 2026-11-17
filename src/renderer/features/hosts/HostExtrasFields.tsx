import { Plus, X } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { MAX_LINKS, MAX_NOTES } from '@shared/host-extras'
import { Button } from '@renderer/components/ui/button'
import { Field } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import type { LinkDraft } from './link-draft'

/** Notes and links, under "More options" in the host form. */
export function HostExtrasFields({
  notes,
  onNotes,
  links,
  onLinks,
  invalidLinks,
}: {
  notes: string
  onNotes: (notes: string) => void
  links: readonly LinkDraft[]
  onLinks: (links: LinkDraft[]) => void
  invalidLinks: ReadonlySet<number>
}) {
  const { t } = useTranslation()
  const linksId = useId()
  const change = (index: number, patch: Partial<LinkDraft>): void => {
    onLinks(links.map((link, at) => (at === index ? { ...link, ...patch } : link)))
  }

  return (
    <>
      <Field label={t('hostForm.notes')} hint={t('hostForm.notesHint')}>
        {({ id, describedBy }) => (
          <Textarea
            id={id}
            dir="auto"
            rows={3}
            maxLength={MAX_NOTES}
            value={notes}
            aria-describedby={describedBy}
            onChange={(event) => {
              onNotes(event.target.value)
            }}
          />
        )}
      </Field>
      <fieldset className="flex flex-col gap-2" aria-describedby={`${linksId}-hint`}>
        <legend className="text-sm font-medium">{t('hostForm.links')}</legend>
        <p id={`${linksId}-hint`} className="text-xs text-muted-foreground">
          {t('hostForm.linksHint')}
        </p>
        {links.map((link, index) => (
          <div key={index} className="flex flex-col gap-1" data-link-row={index}>
            <div className="flex items-center gap-2">
              <Input
                aria-label={t('hostForm.linkTitle', { number: index + 1 })}
                placeholder={t('hostForm.linkTitlePlaceholder')}
                value={link.title}
                maxLength={100}
                className="w-40 shrink-0"
                onChange={(event) => {
                  change(index, { title: event.target.value })
                }}
              />
              <Input
                aria-label={t('hostForm.linkUrl', { number: index + 1 })}
                aria-invalid={invalidLinks.has(index)}
                dir="ltr"
                placeholder="https://panel.example.com"
                value={link.url}
                spellCheck={false}
                className="font-mono"
                onChange={(event) => {
                  change(index, { url: event.target.value })
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('hostForm.linkRemove', { number: index + 1 })}
                onClick={() => {
                  onLinks(links.filter((_link, at) => at !== index))
                }}
              >
                <X aria-hidden />
              </Button>
            </div>
            {invalidLinks.has(index) && (
              <p className="text-xs text-destructive">{t('hostForm.linkInvalid')}</p>
            )}
          </div>
        ))}
        {links.length < MAX_LINKS && (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => {
              onLinks([...links, { title: '', url: '' }])
            }}
          >
            <Plus aria-hidden />
            {t('hostForm.linkAdd')}
          </Button>
        )}
      </fieldset>
    </>
  )
}

import { Server, Zap } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { useUiStore } from '@renderer/stores/ui'

/**
 * What the Hosts section shows before any host exists. Quick Connect is
 * visible but not wired yet; connecting arrives in Phase 1.
 */
export function HostsEmptyState() {
  const { t } = useTranslation()
  const inputId = useId()
  const noteId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const focusRequest = useUiStore((state) => state.quickConnectFocusRequest)
  const [showNote, setShowNote] = useState(false)

  useEffect(() => {
    inputRef.current?.focus()
  }, [focusRequest])

  return (
    <section className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
        <Server aria-hidden className="size-7" />
      </div>
      <div className="flex max-w-md flex-col gap-2">
        <h1 className="text-xl font-semibold">{t('hosts.emptyTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('hosts.emptyBody')}</p>
      </div>
      <form
        className="flex w-full max-w-md flex-col gap-2 text-start"
        onSubmit={(event) => {
          event.preventDefault()
          setShowNote(true)
        }}
      >
        <label htmlFor={inputId} className="flex items-center gap-1.5 text-sm font-medium">
          <Zap aria-hidden className="size-3.5 text-primary" />
          {t('hosts.quickConnectLabel')}
        </label>
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            id={inputId}
            dir="ltr"
            spellCheck={false}
            autoComplete="off"
            placeholder={t('hosts.quickConnectPlaceholder')}
            aria-describedby={showNote ? noteId : undefined}
            className="font-mono"
          />
          <Button type="submit">{t('hosts.quickConnectButton')}</Button>
        </div>
        {showNote && (
          <p id={noteId} role="status" className="text-xs text-muted-foreground">
            {t('hosts.quickConnectNotReady')}
          </p>
        )}
      </form>
    </section>
  )
}

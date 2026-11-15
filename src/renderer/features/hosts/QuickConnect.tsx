import { Zap } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { useUiStore } from '@renderer/stores/ui'

/** Quick Connect: type user@host and press Enter. Wired to sessions in step 1.6. */
export function QuickConnect() {
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
    <form
      className="flex w-full flex-col gap-2 text-start"
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
  )
}

import { Zap } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parseQuickConnect, type QuickConnectError } from '@shared/quick-connect'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { useImportStore } from '@renderer/stores/import'
import { useTabsStore } from '@renderer/stores/tabs'
import { useUiStore } from '@renderer/stores/ui'

/**
 * Quick Connect: type user@host[:port] or paste a full ssh command and press
 * Enter. Nothing is saved; the tab offers "Save host" afterwards.
 */
export function QuickConnect() {
  const { t } = useTranslation()
  const inputId = useId()
  const hintId = useId()
  const errorId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const focusRequest = useUiStore((state) => state.quickConnectFocusRequest)
  const openQuick = useTabsStore((state) => state.openQuick)
  const [value, setValue] = useState('')
  const [error, setError] = useState<{ code: QuickConnectError; option?: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    inputRef.current?.focus()
  }, [focusRequest])

  return (
    <form
      className="flex w-full flex-col gap-2 text-start"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        const parsed = parseQuickConnect(value)
        if (!parsed.ok) {
          setError(
            parsed.option === undefined
              ? { code: parsed.error }
              : { code: parsed.error, option: parsed.option },
          )
          return
        }
        setError(null)
        setBusy(true)
        void openQuick(value.trim()).then((opened) => {
          setBusy(false)
          if (opened) setValue('')
        })
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
          value={value}
          spellCheck={false}
          autoComplete="off"
          placeholder={t('hosts.quickConnectPlaceholder')}
          aria-invalid={error !== null}
          aria-describedby={error === null ? hintId : `${hintId} ${errorId}`}
          className="font-mono"
          onChange={(event) => {
            setValue(event.target.value)
            setError(null)
          }}
          onPaste={(event) => {
            // Several lines (a provider's e-mail): Smart Paste reads them instead.
            const text = event.clipboardData.getData('text')
            if (!text.trim().includes('\n')) return
            event.preventDefault()
            useImportStore.getState().open({ kind: 'smartPaste', text })
          }}
        />
        <Button type="submit" disabled={busy}>
          {t('hosts.quickConnectButton')}
        </Button>
      </div>
      <p id={hintId} className="text-xs text-muted-foreground">
        {t('quickConnect.hint')}
      </p>
      {error !== null && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {t(`quickConnect.errors.${error.code}`, { option: error.option ?? '' })}
        </p>
      )}
    </form>
  )
}

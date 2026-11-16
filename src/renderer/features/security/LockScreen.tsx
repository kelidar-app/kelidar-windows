import { KeyRound, LockKeyhole } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ErrorCode } from '@shared/errors'
import { APP } from '@shared/app'
import { Button } from '@renderer/components/ui/button'
import { Field } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { useVaultStore } from '@renderer/stores/security'

/**
 * Shown instead of the whole app while the vault is locked. It shows the
 * app's name and a password field, nothing else: no host, no tab title, no
 * terminal (they stay hidden behind it, still connected).
 */
export function LockScreen() {
  const { t } = useTranslation()
  const unlock = useVaultStore((state) => state.unlock)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)
  const [capsLock, setCapsLock] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
  }, [])

  const submit = async (): Promise<void> => {
    if (password === '' || busy) return
    setBusy(true)
    const code = await unlock(password)
    setBusy(false)
    if (code === null) return
    setError(code)
    setPassword('')
    input.current?.focus()
  }

  return (
    <div data-lock-screen="" className="flex h-full flex-col bg-background text-foreground">
      <header className="app-drag relative h-(--titlebar-height) shrink-0 border-b border-border bg-titlebar">
        <div className="titlebar-area flex items-center gap-2 ps-3 text-sm text-titlebar-foreground">
          <KeyRound aria-hidden className="size-4 text-primary" />
          <span>{APP.name}</span>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 items-center justify-center p-6">
        <form
          className="flex w-full max-w-sm flex-col gap-5 rounded-lg border border-border bg-card p-6 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <LockKeyhole aria-hidden className="size-6" />
            </div>
            <h1 className="text-lg font-semibold">{t('lock.title', { app: APP.name })}</h1>
            <p className="text-sm text-muted-foreground">{t('lock.body')}</p>
          </div>
          <Field
            label={t('lock.password')}
            hint={capsLock ? t('lock.capsLock') : undefined}
            error={error === null ? null : t(`errors.${error}`)}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                ref={input}
                id={id}
                type="password"
                dir="ltr"
                autoComplete="current-password"
                value={password}
                readOnly={busy}
                aria-invalid={invalid}
                aria-describedby={describedBy}
                onChange={(event) => {
                  setPassword(event.target.value)
                }}
                onKeyUp={(event) => {
                  setCapsLock(event.getModifierState('CapsLock'))
                }}
              />
            )}
          </Field>
          <Button type="submit" disabled={password === '' || busy}>
            {busy ? t('lock.unlocking') : t('lock.unlock')}
          </Button>
          <p className="text-xs text-muted-foreground">{t('lock.forgotten')}</p>
        </form>
      </main>
    </div>
  )
}

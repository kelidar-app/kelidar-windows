import { Loader2 } from 'lucide-react'
import type { ReactNode, SyntheticEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './button'
import { Dialog } from './dialog'

/** An error for the whole form, above its buttons. */
export function FormError({ message }: { message: string | undefined }) {
  if (message === undefined) return null
  return (
    <p
      role="alert"
      className="rounded-md border border-destructive px-3 py-2 text-sm text-destructive"
    >
      {message}
    </p>
  )
}

/** A dialog holding one form, with Cancel and a submit button. */
export function FormDialog({
  title,
  description,
  onDone,
  onSubmit,
  busy,
  submitLabel,
  children,
}: {
  title: string
  description?: string
  onDone: () => void
  onSubmit: (event: SyntheticEvent) => void
  busy: boolean
  submitLabel: string
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <Dialog
      open
      onClose={onDone}
      title={title}
      {...(description === undefined ? {} : { description })}
    >
      <form className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
        {children}
        <div className="flex justify-end gap-2 pb-5">
          <Button variant="outline" onClick={onDone}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 aria-hidden className="animate-spin" />}
            {submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

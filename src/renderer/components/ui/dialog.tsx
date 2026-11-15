import { useEffect, useId, useRef, type ReactNode } from 'react'
import { cn } from '@renderer/lib/cn'

interface DialogProps {
  open: boolean
  /** Esc, the backdrop and Cancel buttons call this. */
  onClose: () => void
  title: string
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  className?: string
  /** For warnings: the dialog is announced as an alert dialog. */
  role?: 'dialog' | 'alertdialog'
  /** Set false while a dialog must not be dismissed by Esc. */
  dismissible?: boolean
}

/**
 * A modal built on the native <dialog> element: focus moves into it and stays
 * there, Esc closes it, and the page behind it is inert. No dependency needed.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  role = 'dialog',
  dismissible = true,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const element = ref.current
    if (element === null) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      role={role}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      onCancel={(event) => {
        event.preventDefault()
        if (dismissible) onClose()
      }}
      className={cn(
        'm-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/40',
        className,
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex flex-col gap-1.5 px-5 pt-5">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            {description !== undefined && (
              <div id={descriptionId} className="text-sm text-muted-foreground">
                {description}
              </div>
            )}
          </div>
          {children !== undefined && (
            <div className="min-h-0 overflow-y-auto px-5 pt-4">{children}</div>
          )}
          {footer !== undefined && (
            <div className="flex flex-wrap justify-end gap-2 px-5 pt-5 pb-5">{footer}</div>
          )}
        </div>
      )}
    </dialog>
  )
}

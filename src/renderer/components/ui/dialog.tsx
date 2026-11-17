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
  /** The title is still read by screen readers, just not shown (the command palette). */
  hideTitle?: boolean
}

/**
 * A modal built on the native <dialog> element: focus moves into it and stays
 * there, Esc closes it, and the page behind it is inert. No dependency needed.
 * Mark the control that should get focus first with `autoFocus data-autofocus`.
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
  hideTitle = false,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const element = ref.current
    if (element === null) return
    if (open && !element.open) {
      element.showModal()
      // React's autoFocus runs before the dialog is shown, when nothing in it
      // can take focus, so the element marked data-autofocus is focused here.
      element.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    }
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
          <div className={cn('flex flex-col gap-1.5 px-5 pt-5', hideTitle && 'sr-only')}>
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
            // relative: visually hidden inputs (sr-only) are placed inside the
            // scrolling area, not against the dialog, so the dialog never scrolls too.
            // pb-1: Persian glyphs reach a pixel below their line; the padding
            // holds them, so a short dialog shows no scroll bar.
            <div className={cn('relative min-h-0 overflow-y-auto', !hideTitle && 'px-5 pt-4 pb-1')}>
              {children}
            </div>
          )}
          {footer !== undefined && (
            <div className="flex flex-wrap justify-end gap-2 px-5 pt-4 pb-5">{footer}</div>
          )}
        </div>
      )}
    </dialog>
  )
}

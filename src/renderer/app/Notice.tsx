import { CircleAlert, CircleCheck, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/cn'
import { useNoticeStore } from '@renderer/stores/notice'

/** The latest short message ("Password copied…"), read out by screen readers. */
export function Notice() {
  const { t } = useTranslation()
  const notice = useNoticeStore((state) => state.notice)
  const dismiss = useNoticeStore((state) => state.dismiss)
  const error = notice?.kind === 'error'
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
    >
      {notice !== null && (
        <div
          key={notice.id}
          data-notice={notice.kind}
          className={cn(
            'pointer-events-auto flex max-w-lg items-start gap-2 rounded-md border bg-card px-3 py-2 text-sm shadow-lg',
            error ? 'border-destructive text-destructive' : 'border-border text-card-foreground',
          )}
        >
          {error ? (
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          ) : (
            <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
          )}
          <span>
            {notice.kind === 'error'
              ? t(`errors.${notice.code}`)
              : t(notice.key, notice.values ?? {})}
          </span>
          <button
            type="button"
            aria-label={t('common.close')}
            className="ms-1 shrink-0 rounded text-muted-foreground hover:text-foreground"
            onClick={dismiss}
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      )}
    </div>
  )
}

import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { useTerminalUiStore, type PasteRequest } from '@renderer/stores/terminal-ui'

const PREVIEW_LINES = 40

/**
 * Shown before text with line breaks reaches a shell, where each line runs as
 * a command. On a production host the user must also tick a box.
 */
export function PasteGuardDialog() {
  const request = useTerminalUiStore((state) => state.paste)
  if (request === null) return null
  // A new key per request resets the checkbox.
  return <PasteGuard key={`${request.paneId}:${String(request.text.length)}`} request={request} />
}

function PasteGuard({ request }: { request: PasteRequest }) {
  const { t } = useTranslation()
  const answer = useTerminalUiStore((state) => state.answerPaste)
  const [checked, setChecked] = useState(false)
  const lines = request.text.replace(/(\r\n|\r|\n)$/, '').split(/\r\n|\r|\n/)
  const hidden = lines.length - PREVIEW_LINES
  const canPaste = !request.production || checked

  return (
    <Dialog
      open
      onClose={() => {
        answer(false)
      }}
      role="alertdialog"
      title={t('paste.title', { count: lines.length })}
      description={t('paste.body')}
      className="w-[min(40rem,calc(100vw-2rem))]"
      footer={
        <>
          <Button
            variant="outline"
            autoFocus
            data-autofocus
            onClick={() => {
              answer(false)
            }}
          >
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!canPaste}
            className={
              request.production
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : undefined
            }
            onClick={() => {
              answer(true)
            }}
          >
            {t('paste.confirm', { count: lines.length })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {request.production && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm"
          >
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-red-600" />
            <p>{t('paste.production')}</p>
          </div>
        )}
        <pre
          dir="ltr"
          data-paste-preview=""
          className="max-h-72 overflow-auto rounded-md border border-border bg-muted p-3 text-start font-mono text-xs whitespace-pre select-text"
        >
          {lines.slice(0, PREVIEW_LINES).join('\n')}
        </pre>
        {hidden > 0 && (
          <p className="text-xs text-muted-foreground">{t('paste.more', { count: hidden })}</p>
        )}
        {request.production && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={checked}
              className="mt-0.5 size-4 accent-destructive"
              onChange={(event) => {
                setChecked(event.target.checked)
              }}
            />
            <span>{t('paste.productionConfirm')}</span>
          </label>
        )}
      </div>
    </Dialog>
  )
}

import { ClipboardPaste, Download, Eye, EyeOff, Loader2, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatTarget } from '@shared/address'
import type { ErrorCode } from '@shared/errors'
import type { ImportCandidate, ImportScan, ImportSource } from '@shared/importers'
import { parseSmartPaste } from '@shared/smart-paste'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { Field } from '@renderer/components/ui/field'
import { FormError } from '@renderer/components/ui/form-dialog'
import { Textarea } from '@renderer/components/ui/textarea'
import { api } from '@renderer/lib/api'
import { useHostFormStore, useHostsStore } from '@renderer/stores/hosts'
import { useImportStore } from '@renderer/stores/import'
import { useKeychainStore } from '@renderer/stores/keychain'
import { showNotice } from '@renderer/stores/notice'
import { useUiStore } from '@renderer/stores/ui'
import { HostInfoDialog } from './HostInfoDialog'

/** Renders whichever import, Smart Paste or host info dialog is open. */
export function ImportDialogs() {
  const dialog = useImportStore((state) => state.dialog)
  const close = useImportStore((state) => state.close)
  switch (dialog.kind) {
    case 'welcome':
      return <WelcomeDialog scan={dialog.scan} onDone={close} />
    case 'preview':
      return <ImportPreviewDialog scan={dialog.scan} onDone={close} />
    case 'smartPaste':
      return <SmartPasteDialog text={dialog.text ?? ''} onDone={close} />
    case 'hostInfo':
      return <HostInfoDialog host={dialog.host} onDone={close} />
    case 'none':
      return null
  }
}

const SOURCES: readonly ImportSource[] = ['sshConfig', 'putty']
/** Inserted as a value, so it keeps its order inside Persian sentences. */
const SSH_CONFIG_PATH = '~/.ssh/config'

/** The first-run offer: shown once, when the vault is empty and something was found. */
function WelcomeDialog({ scan, onDone }: { scan: ImportScan; onDone: () => void }) {
  const { t } = useTranslation()
  const open = useImportStore((state) => state.open)
  const counts = SOURCES.map((source) => ({
    source,
    count: scan.candidates.filter((candidate) => candidate.source === source).length,
  })).filter((item) => item.count > 0)

  return (
    <Dialog
      open
      onClose={onDone}
      title={t('import.welcomeTitle')}
      description={t('import.welcomeBody')}
      footer={
        <>
          <Button variant="outline" onClick={onDone}>
            {t('import.notNow')}
          </Button>
          <Button
            data-autofocus
            onClick={() => {
              open({ kind: 'preview', scan })
            }}
          >
            {t('import.review')}
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-2 text-sm">
        {counts.map(({ source, count }) => (
          <li key={source} className="flex items-center gap-2" data-import-source={source}>
            <Download aria-hidden className="size-4 text-primary" />
            {t(`import.found.${source}`, { count })}
          </li>
        ))}
      </ul>
    </Dialog>
  )
}

/** One line under a row: how it signs in, through what, and anything to know. */
function CandidateDetails({ candidate }: { candidate: ImportCandidate }) {
  const { t } = useTranslation()
  const parts = [
    candidate.signIn === 'key'
      ? t('import.signInKey', { name: candidate.keyName ?? '' })
      : candidate.signIn === 'agent'
        ? t('import.signInAgent')
        : t('import.signInAsk'),
    ...(candidate.jump === undefined ? [] : [t('import.via', { name: candidate.jump })]),
    ...(candidate.proxy === undefined
      ? []
      : [t('import.proxy', { host: `${candidate.proxy.host}:${String(candidate.proxy.port)}` })]),
  ]
  return (
    <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
      <span>{parts.join(' · ')}</span>
      {candidate.duplicateOf !== undefined && (
        <span>{t('import.duplicate', { name: candidate.duplicateOf })}</span>
      )}
      {candidate.warnings.map((warning) => (
        <span key={warning} className="flex items-start gap-1 text-amber-700 dark:text-amber-400">
          <TriangleAlert aria-hidden className="mt-0.5 size-3 shrink-0" />
          {t(`import.warnings.${warning}`)}
        </span>
      ))}
    </div>
  )
}

/** The rows found, each with a checkbox; already-saved hosts start unticked. */
function ImportPreviewDialog({ scan, onDone }: { scan?: ImportScan; onDone: () => void }) {
  const { t } = useTranslation()
  const [result, setResult] = useState<ImportScan | null>(scan ?? null)
  const [chosen, setChosen] = useState<Set<string>>(
    () =>
      new Set(
        (scan?.candidates ?? [])
          .filter((candidate) => candidate.duplicateOf === undefined)
          .map((candidate) => candidate.id),
      ),
  )
  const [failure, setFailure] = useState<ErrorCode | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (scan !== undefined) return
    let alive = true
    void api.invoke('import:scan').then((answer) => {
      if (!alive) return
      if (!answer.ok) {
        setFailure(answer.error.code)
        return
      }
      setResult(answer.data)
      setChosen(
        new Set(
          answer.data.candidates
            .filter((candidate) => candidate.duplicateOf === undefined)
            .map((candidate) => candidate.id),
        ),
      )
    })
    return () => {
      alive = false
    }
  }, [scan])

  const toggle = (id: string, on: boolean): void => {
    setChosen((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const apply = async (): Promise<void> => {
    if (result === null || chosen.size === 0) return
    setBusy(true)
    const answer = await api.invoke('import:apply', { token: result.token, ids: [...chosen] })
    setBusy(false)
    if (!answer.ok) {
      setFailure(answer.error.code)
      return
    }
    await Promise.all([useHostsStore.getState().load(), useKeychainStore.getState().load()])
    showNotice({
      kind: 'info',
      key: answer.data.keys > 0 ? 'import.doneWithKeys' : 'import.done',
      values: { count: answer.data.hosts, keys: answer.data.keys },
    })
    useUiStore.getState().showSection('hosts')
    onDone()
  }

  const candidates = result?.candidates ?? []
  return (
    <Dialog
      open
      onClose={onDone}
      title={t('import.title')}
      description={t('import.body', { path: SSH_CONFIG_PATH })}
      className="w-[min(44rem,calc(100vw-2rem))]"
      footer={
        <>
          <Button variant="outline" onClick={onDone}>
            {t('common.cancel')}
          </Button>
          <Button data-autofocus disabled={busy || chosen.size === 0} onClick={() => void apply()}>
            {busy && <Loader2 aria-hidden className="animate-spin" />}
            {t('import.apply', { count: chosen.size })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FormError message={failure === null ? undefined : t(`errors.${failure}`)} />
        {result === null ? (
          failure === null && <Loader2 aria-hidden className="size-5 animate-spin" />
        ) : candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('import.nothing', { path: SSH_CONFIG_PATH })}
          </p>
        ) : (
          SOURCES.map((source) => {
            const rows = candidates.filter((candidate) => candidate.source === source)
            if (rows.length === 0) return null
            const allOn = rows.every((row) => chosen.has(row.id))
            return (
              <section key={source} className="flex flex-col gap-1" data-import-source={source}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-muted-foreground">
                    {t(`import.sources.${source}`)}
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      for (const row of rows) toggle(row.id, !allOn)
                    }}
                  >
                    {allOn ? t('import.selectNone') : t('import.selectAll')}
                  </Button>
                </div>
                <ul className="flex flex-col gap-1">
                  {rows.map((candidate) => (
                    <li key={candidate.id} data-import-row={candidate.name}>
                      <label className="flex items-start gap-3 rounded-md border border-border px-3 py-2 hover:bg-muted">
                        <input
                          type="checkbox"
                          className="mt-1 size-4 accent-primary"
                          checked={chosen.has(candidate.id)}
                          onChange={(event) => {
                            toggle(candidate.id, event.target.checked)
                          }}
                        />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="flex flex-wrap items-baseline gap-x-2">
                            <span dir="auto" className="text-sm font-medium">
                              {candidate.name}
                            </span>
                            <span dir="ltr" className="font-mono text-xs text-muted-foreground">
                              {formatTarget(candidate)}
                            </span>
                          </span>
                          <CandidateDetails candidate={candidate} />
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })
        )}
      </div>
    </Dialog>
  )
}

/**
 * Smart Paste: free text in, a preview of what was found, then the host form
 * opens filled in, where the user checks everything before saving.
 */
function SmartPasteDialog({ text: initial, onDone }: { text: string; onDone: () => void }) {
  const { t } = useTranslation()
  const [text, setText] = useState(initial)
  const [showPassword, setShowPassword] = useState(false)
  const found = useMemo(() => parseSmartPaste(text), [text])

  const fill = (): void => {
    if (found.address === undefined) return
    onDone()
    useUiStore.getState().showSection('hosts')
    useHostFormStore.getState().openNew({
      name: found.address,
      address: found.address,
      ...(found.port === undefined ? {} : { port: found.port }),
      ...(found.username === undefined ? {} : { username: found.username }),
      ...(found.password === undefined ? {} : { password: found.password }),
    })
  }

  const rows: { label: string; value: string | undefined; secret?: boolean }[] = [
    { label: t('hostForm.address'), value: found.address },
    { label: t('hostForm.port'), value: found.port === undefined ? undefined : String(found.port) },
    { label: t('hostForm.username'), value: found.username },
    { label: t('hostForm.password'), value: found.password, secret: true },
  ]

  return (
    <Dialog
      open
      onClose={onDone}
      title={t('smartPaste.title')}
      description={t('smartPaste.body')}
      footer={
        <>
          <Button variant="outline" onClick={onDone}>
            {t('common.cancel')}
          </Button>
          <Button disabled={found.address === undefined} onClick={fill}>
            <ClipboardPaste aria-hidden />
            {t('smartPaste.fill')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('smartPaste.text')}>
          {({ id }) => (
            <Textarea
              id={id}
              dir="auto"
              rows={7}
              autoFocus
              data-autofocus
              spellCheck={false}
              value={text}
              placeholder={t('smartPaste.placeholder')}
              onChange={(event) => {
                setText(event.target.value)
              }}
            />
          )}
        </Field>
        <section aria-label={t('smartPaste.found')} className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold text-muted-foreground">{t('smartPaste.found')}</h3>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 text-sm">
            {rows.map((row) => (
              <div key={row.label} className="contents" data-smart-field={row.label}>
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="flex min-w-0 items-center gap-2">
                  {row.value === undefined ? (
                    <span className="text-muted-foreground">{t('smartPaste.notFound')}</span>
                  ) : (
                    <span dir="ltr" className="truncate font-mono">
                      {row.secret === true && !showPassword ? '•'.repeat(8) : row.value}
                    </span>
                  )}
                  {row.secret === true && row.value !== undefined && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-pressed={showPassword}
                      aria-label={showPassword ? t('smartPaste.hide') : t('smartPaste.show')}
                      onClick={() => {
                        setShowPassword((on) => !on)
                      }}
                    >
                      {showPassword ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                    </Button>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {text.trim() !== '' && found.address === undefined && (
            <p role="status" className="text-xs text-muted-foreground">
              {t('smartPaste.noAddress')}
            </p>
          )}
        </section>
      </div>
    </Dialog>
  )
}

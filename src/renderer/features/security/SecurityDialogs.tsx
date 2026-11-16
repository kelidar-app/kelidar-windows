import { FileUp, Loader2 } from 'lucide-react'
import { useEffect, useState, type SyntheticEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { ErrorCode } from '@shared/errors'
import { MIN_PASSWORD_LENGTH, type BackupInfoView } from '@shared/security'
import { Button } from '@renderer/components/ui/button'
import { ChoiceGroup } from '@renderer/components/ui/choice-group'
import { Dialog } from '@renderer/components/ui/dialog'
import { Field } from '@renderer/components/ui/field'
import { FormDialog, FormError } from '@renderer/components/ui/form-dialog'
import { Input } from '@renderer/components/ui/input'
import { api } from '@renderer/lib/api'
import { showNotice } from '@renderer/stores/notice'
import { useSecurityDialogStore, useVaultStore } from '@renderer/stores/security'

/** Renders whichever security dialog is open. */
export function SecurityDialogs() {
  const open = useSecurityDialogStore((state) => state.open)
  const close = useSecurityDialogStore((state) => state.close)
  switch (open) {
    case 'masterPassword':
      return <MasterPasswordDialog onDone={close} />
    case 'export':
      return <ExportDialog onDone={close} />
    case 'import':
      return <ImportDialog onDone={close} />
    case 'restore':
      return <RestoreDialog onDone={close} />
    case null:
      return null
  }
}

function PasswordField({
  label,
  value,
  onChange,
  error,
  hint,
  autoComplete,
  autoFocus = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  error?: string | undefined
  hint?: string
  autoComplete: 'new-password' | 'current-password' | 'off'
  autoFocus?: boolean
}) {
  return (
    <Field label={label} hint={hint} error={error ?? null}>
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          type="password"
          dir="ltr"
          autoComplete={autoComplete}
          value={value}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          {...(autoFocus ? { autoFocus: true, 'data-autofocus': true } : {})}
          onChange={(event) => {
            onChange(event.target.value)
          }}
        />
      )}
    </Field>
  )
}

/** A new password typed twice: the field errors, or null when both are fine. */
function useNewPasswordCheck(): (
  next: string,
  confirm: string,
) => { next?: string; confirm?: string } | null {
  const { t } = useTranslation()
  return (next, confirm) => {
    if (next.length < MIN_PASSWORD_LENGTH) {
      return { next: t('security.tooShort', { min: MIN_PASSWORD_LENGTH }) }
    }
    if (next !== confirm) return { confirm: t('security.mismatch') }
    return null
  }
}

function MasterPasswordDialog({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const hasPassword = useVaultStore((state) => state.status.masterPassword)
  const apply = useVaultStore((state) => state.apply)
  const [action, setAction] = useState<'change' | 'remove'>('change')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({})
  const [failure, setFailure] = useState<ErrorCode | null>(null)
  const [busy, setBusy] = useState(false)
  const checkNewPassword = useNewPasswordCheck()
  const removing = hasPassword && action === 'remove'

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault()
    if (busy) return
    const problems = removing ? null : checkNewPassword(next, confirm)
    const missingCurrent = hasPassword && current === ''
    if (problems !== null || missingCurrent) {
      setErrors({
        ...(problems ?? {}),
        ...(missingCurrent ? { current: t('security.currentRequired') } : {}),
      })
      return
    }
    setErrors({})
    setBusy(true)
    const result = await api.invoke('vault:setMasterPassword', {
      ...(hasPassword ? { current } : {}),
      next: removing ? null : next,
    })
    setBusy(false)
    if (!result.ok) {
      if (result.error.code === 'VAULT_PASSWORD_WRONG') {
        setErrors({ current: t('errors.VAULT_PASSWORD_WRONG') })
      } else {
        setFailure(result.error.code)
      }
      return
    }
    apply(result.data)
    showNotice({
      kind: 'info',
      key: removing
        ? 'security.removedNotice'
        : hasPassword
          ? 'security.changedNotice'
          : 'security.setNotice',
    })
    onDone()
  }

  return (
    <FormDialog
      title={hasPassword ? t('security.changeTitle') : t('security.setTitle')}
      description={t('security.masterPasswordBody')}
      onDone={onDone}
      onSubmit={(event) => void submit(event)}
      busy={busy}
      submitLabel={
        removing
          ? t('security.removeAction')
          : hasPassword
            ? t('security.changeAction')
            : t('security.setAction')
      }
    >
      {hasPassword && (
        <>
          <ChoiceGroup
            legend={t('security.whatToDo')}
            value={action}
            choices={[
              { value: 'change', label: t('security.changeChoice') },
              { value: 'remove', label: t('security.removeChoice') },
            ]}
            onChange={setAction}
          />
          <PasswordField
            label={t('security.current')}
            value={current}
            onChange={setCurrent}
            error={errors.current}
            autoComplete="current-password"
            autoFocus
          />
        </>
      )}
      {!removing && (
        <>
          <PasswordField
            label={t('security.new')}
            hint={t('security.newHint', { min: MIN_PASSWORD_LENGTH })}
            value={next}
            onChange={setNext}
            error={errors.next}
            autoComplete="new-password"
            autoFocus={!hasPassword}
          />
          <PasswordField
            label={t('security.confirm')}
            value={confirm}
            onChange={setConfirm}
            error={errors.confirm}
            autoComplete="new-password"
          />
        </>
      )}
      <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        {removing ? t('security.removeWarning') : t('security.forgetWarning')}
      </p>
      <FormError message={failure === null ? undefined : t(`errors.${failure}`)} />
    </FormDialog>
  )
}

function ExportDialog({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ next?: string; confirm?: string }>({})
  const [failure, setFailure] = useState<ErrorCode | null>(null)
  const [busy, setBusy] = useState(false)
  const checkNewPassword = useNewPasswordCheck()

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault()
    if (busy) return
    const problems = checkNewPassword(password, confirm)
    setErrors(problems ?? {})
    if (problems !== null) return
    setBusy(true)
    const result = await api.invoke('data:export', { password })
    setBusy(false)
    if (!result.ok) {
      setFailure(result.error.code)
      return
    }
    // null: the save dialog was cancelled; the form stays.
    if (result.data === null) return
    showNotice({ kind: 'info', key: 'security.exported', values: { file: result.data.fileName } })
    onDone()
  }

  return (
    <FormDialog
      title={t('security.exportTitle')}
      description={t('security.exportBody')}
      onDone={onDone}
      onSubmit={(event) => void submit(event)}
      busy={busy}
      submitLabel={t('security.exportAction')}
    >
      <PasswordField
        label={t('security.filePassword')}
        hint={t('security.newHint', { min: MIN_PASSWORD_LENGTH })}
        value={password}
        onChange={setPassword}
        error={errors.next}
        autoComplete="new-password"
        autoFocus
      />
      <PasswordField
        label={t('security.confirm')}
        value={confirm}
        onChange={setConfirm}
        error={errors.confirm}
        autoComplete="new-password"
      />
      <FormError message={failure === null ? undefined : t(`errors.${failure}`)} />
    </FormDialog>
  )
}

function ImportDialog({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const [file, setFile] = useState<{ token: string; fileName: string } | null>(null)
  const [password, setPassword] = useState('')
  const [failure, setFailure] = useState<ErrorCode | null>(null)
  const [busy, setBusy] = useState(false)

  const pick = async (): Promise<void> => {
    setBusy(true)
    const result = await api.invoke('data:importPick')
    setBusy(false)
    if (!result.ok) {
      setFailure(result.error.code)
      return
    }
    if (result.data !== null) {
      setFile(result.data)
      setFailure(null)
    }
  }

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault()
    if (busy) return
    if (file === null) {
      void pick()
      return
    }
    if (password === '') {
      setFailure('IMPORT_PASSWORD_WRONG')
      return
    }
    setBusy(true)
    const result = await api.invoke('data:import', { token: file.token, password })
    setBusy(false)
    if (!result.ok) {
      setFailure(result.error.code)
      if (result.error.code === 'IMPORT_EXPIRED') setFile(null)
      return
    }
    useVaultStore.getState().reloadData()
    showNotice({ kind: 'info', key: 'security.imported', values: result.data })
    onDone()
  }

  return (
    <FormDialog
      title={t('security.importTitle')}
      description={t('security.importBody')}
      onDone={onDone}
      onSubmit={(event) => void submit(event)}
      busy={busy}
      submitLabel={file === null ? t('security.chooseFile') : t('security.importAction')}
    >
      {file === null ? (
        <Button variant="outline" className="self-start" onClick={() => void pick()}>
          <FileUp aria-hidden />
          {t('security.chooseFile')}
        </Button>
      ) : (
        <>
          <p className="text-sm">
            {t('security.chosenFile')}{' '}
            <span dir="auto" className="font-medium">
              {file.fileName}
            </span>
          </p>
          <PasswordField
            label={t('security.filePassword')}
            value={password}
            onChange={setPassword}
            autoComplete="off"
            autoFocus
          />
        </>
      )}
      <FormError message={failure === null ? undefined : t(`errors.${failure}`)} />
    </FormDialog>
  )
}

function RestoreDialog({ onDone }: { onDone: () => void }) {
  const { t, i18n } = useTranslation()
  const apply = useVaultStore((state) => state.apply)
  const [backups, setBackups] = useState<BackupInfoView[] | null>(null)
  const [chosen, setChosen] = useState<BackupInfoView | null>(null)
  const [failure, setFailure] = useState<ErrorCode | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void api.invoke('vault:backups').then((result) => {
      if (!alive) return
      if (result.ok) setBackups(result.data)
      else setFailure(result.error.code)
    })
    return () => {
      alive = false
    }
  }, [])

  const when = (backup: BackupInfoView): string =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(backup.savedAt),
    )
  const size = (bytes: number): string =>
    new Intl.NumberFormat(i18n.language, { style: 'unit', unit: 'kilobyte' }).format(
      Math.max(1, Math.round(bytes / 1024)),
    )

  const restore = async (backup: BackupInfoView): Promise<void> => {
    setBusy(true)
    const result = await api.invoke('vault:restore', { name: backup.name })
    setBusy(false)
    if (!result.ok) {
      setFailure(result.error.code)
      setChosen(null)
      return
    }
    showNotice({ kind: 'info', key: 'security.restored', values: { when: when(backup) } })
    onDone()
    // Read everything from the restored copy (or show the lock screen).
    apply(result.data)
    useVaultStore.getState().reloadData()
  }

  return (
    <Dialog
      open
      onClose={onDone}
      title={t('security.restoreTitle')}
      description={t('security.restoreBody')}
      footer={
        chosen === null ? (
          <Button variant="outline" onClick={onDone}>
            {t('common.close')}
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              onClick={() => {
                setChosen(null)
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button data-autofocus disabled={busy} onClick={() => void restore(chosen)}>
              {busy && <Loader2 aria-hidden className="animate-spin" />}
              {t('security.restoreConfirm')}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <FormError message={failure === null ? undefined : t(`errors.${failure}`)} />
        {chosen !== null ? (
          <p role="alert" className="text-sm">
            {t('security.restoreWarning', { when: when(chosen) })}
          </p>
        ) : backups === null ? (
          failure === null && <Loader2 aria-hidden className="size-5 animate-spin" />
        ) : backups.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('security.noBackups')}</p>
        ) : (
          <ul aria-label={t('security.backups')} className="flex flex-col gap-1">
            {backups.map((backup, index) => (
              <li
                key={backup.name}
                data-backup={backup.name}
                className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium">{when(backup)}</span>
                  <span className="text-xs text-muted-foreground">
                    {backup.protection === null
                      ? t('security.backupDamaged')
                      : t('security.backupDetails', {
                          size: size(backup.size),
                          protection:
                            backup.protection === 'password'
                              ? t('security.protectionPassword')
                              : t('security.protectionWindows'),
                        })}
                    {index === 0 && ` · ${t('security.newest')}`}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={backup.protection === null}
                  aria-label={t('security.restoreOne', { when: when(backup) })}
                  onClick={() => {
                    setFailure(null)
                    setChosen(backup)
                  }}
                >
                  {t('security.restoreAction')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  )
}

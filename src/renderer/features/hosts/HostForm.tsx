import { ChevronDown, FileKey } from 'lucide-react'
import { useId, useState, type SyntheticEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { normalizeAddress } from '@shared/address'
import type { ErrorCode } from '@shared/errors'
import { usernameSchema, type HostSaveRequest, type KeyFileInfo } from '@shared/hosts'
import { DEFAULT_SSH_PORT, MAX_PORT } from '@shared/records'
import { Button } from '@renderer/components/ui/button'
import { ChoiceGroup } from '@renderer/components/ui/choice-group'
import { Dialog } from '@renderer/components/ui/dialog'
import { Field } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { api } from '@renderer/lib/api'
import { useHostFormStore, useHostsStore, type HostFormState } from '@renderer/stores/hosts'
import { useTabsStore } from '@renderer/stores/tabs'

type Method = 'password' | 'key'

/** Errors that belong next to one field rather than at the top of the form. */
const FIELD_ERRORS: Partial<Record<ErrorCode, 'key' | 'passphrase'>> = {
  KEY_FILE_UNREADABLE: 'key',
  KEY_FILE_EXPIRED: 'key',
  KEY_INVALID: 'key',
  KEY_REQUIRED: 'key',
  KEY_PASSPHRASE_REQUIRED: 'passphrase',
  KEY_PASSPHRASE_WRONG: 'passphrase',
}

export function HostFormDialog() {
  const form = useHostFormStore((state) => state.form)
  const close = useHostFormStore((state) => state.close)
  const { t } = useTranslation()
  return (
    <Dialog
      open={form.mode !== 'closed'}
      onClose={close}
      title={form.mode === 'edit' ? t('hostForm.editTitle') : t('hostForm.newTitle')}
    >
      {form.mode !== 'closed' && <HostForm form={form} onDone={close} />}
    </Dialog>
  )
}

/**
 * The four fields: name, address, user name and sign-in method. Port sits
 * under "More options". Passwords and passphrases live only in this
 * component's state and go to main once, on save.
 */
function HostForm({
  form,
  onDone,
}: {
  form: Exclude<HostFormState, { mode: 'closed' }>
  onDone: () => void
}) {
  const { t } = useTranslation()
  const save = useHostsStore((state) => state.save)
  const adoptHost = useTabsStore((state) => state.adoptHost)
  const editing = form.mode === 'edit' ? form.host : undefined
  const prefill = form.mode === 'new' ? form.prefill : undefined
  const moreId = useId()

  const [name, setName] = useState(editing?.name ?? '')
  const [address, setAddress] = useState(editing?.address ?? prefill?.address ?? '')
  const [username, setUsername] = useState(editing?.username ?? prefill?.username ?? '')
  const sessionId = prefill?.sessionId
  const [useSessionSignIn, setUseSessionSignIn] = useState(sessionId !== undefined)
  const [method, setMethod] = useState<Method>(
    editing?.signIn.method === 'key' ? 'key' : 'password',
  )
  const [password, setPassword] = useState('')
  const [forgetPassword, setForgetPassword] = useState(false)
  const [keyFile, setKeyFile] = useState<KeyFileInfo | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const initialPort = editing?.port ?? prefill?.port ?? DEFAULT_SSH_PORT
  const [port, setPort] = useState(initialPort === DEFAULT_SSH_PORT ? '' : String(initialPort))
  const [showMore, setShowMore] = useState(initialPort !== DEFAULT_SSH_PORT)
  const [errors, setErrors] = useState<{
    address?: string
    username?: string
    port?: string
    key?: string
    passphrase?: string
    form?: string
  }>({})
  const [saving, setSaving] = useState(false)

  const savedPassword = editing?.signIn.method === 'password' && !forgetPassword
  const savedKey = editing?.signIn.method === 'key' ? editing.signIn : undefined
  const needsPassphrase = keyFile !== null ? keyFile.encrypted : (savedKey?.hasPassphrase ?? false)

  const showError = (code: ErrorCode): void => {
    const field = FIELD_ERRORS[code]
    const message = t(`errors.${code}`)
    setErrors(field === undefined ? { form: message } : { [field]: message })
  }

  const pickKey = async (): Promise<void> => {
    const result = await api.invoke('hosts:pickKeyFile')
    if (!result.ok) {
      showError(result.error.code)
      return
    }
    if (result.data !== null) {
      setKeyFile(result.data)
      setPassphrase('')
      setErrors({})
    }
  }

  const buildAuth = (): HostSaveRequest['auth'] | null => {
    if (useSessionSignIn && sessionId !== undefined) return { type: 'fromSession', sessionId }
    if (method === 'password') {
      if (password !== '') return { type: 'password', password }
      return savedPassword ? { type: 'password' } : { type: 'password', password: '' }
    }
    if (keyFile !== null) {
      if (keyFile.encrypted && passphrase === '') {
        setErrors({ passphrase: t('errors.KEY_PASSPHRASE_REQUIRED') })
        return null
      }
      return {
        type: 'key',
        keyFileToken: keyFile.token,
        ...(keyFile.encrypted ? { passphrase } : {}),
      }
    }
    if (savedKey !== undefined) {
      return passphrase === '' ? { type: 'key' } : { type: 'key', passphrase }
    }
    setErrors({ key: t('errors.KEY_REQUIRED') })
    return null
  }

  const onSubmit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault()
    const next: typeof errors = {}
    const cleanAddress = normalizeAddress(address)
    if (cleanAddress === null) next.address = t('hostForm.addressInvalid')
    if (!usernameSchema.safeParse(username).success) next.username = t('hostForm.usernameInvalid')
    const portNumber = port.trim() === '' ? undefined : Number(port)
    if (
      portNumber !== undefined &&
      (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > MAX_PORT)
    ) {
      next.port = t('hostForm.portInvalid', { max: MAX_PORT })
      setShowMore(true)
    }
    setErrors(next)
    if (Object.keys(next).length > 0 || cleanAddress === null) return
    const auth = buildAuth()
    if (auth === null) return

    setSaving(true)
    const result = await save({
      ...(editing === undefined ? {} : { id: editing.id }),
      name: name.trim() === '' ? cleanAddress : name.trim(),
      address: cleanAddress,
      ...(portNumber === undefined || portNumber === DEFAULT_SSH_PORT ? {} : { port: portNumber }),
      username: username.trim(),
      auth,
    })
    setSaving(false)
    if (result.ok) {
      if (sessionId !== undefined) adoptHost(sessionId, result.data)
      onDone()
    } else showError(result.code)
  }

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        void onSubmit(event)
      }}
    >
      {errors.form !== undefined && (
        <p
          role="alert"
          className="rounded-md border border-destructive px-3 py-2 text-sm text-destructive"
        >
          {errors.form}
        </p>
      )}

      <Field label={t('hostForm.name')} hint={t('hostForm.nameHint')}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            value={name}
            maxLength={200}
            autoComplete="off"
            placeholder={t('hostForm.namePlaceholder')}
            aria-describedby={describedBy}
            onChange={(event) => {
              setName(event.target.value)
            }}
          />
        )}
      </Field>

      <Field label={t('hostForm.address')} error={errors.address ?? null}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            dir="ltr"
            value={address}
            required
            autoFocus
            spellCheck={false}
            autoComplete="off"
            placeholder="server.example.com"
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className="font-mono"
            onChange={(event) => {
              setAddress(event.target.value)
            }}
          />
        )}
      </Field>

      <Field label={t('hostForm.username')} error={errors.username ?? null}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            dir="ltr"
            value={username}
            required
            spellCheck={false}
            autoComplete="off"
            placeholder="root"
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className="font-mono"
            onChange={(event) => {
              setUsername(event.target.value)
            }}
          />
        )}
      </Field>

      {sessionId !== undefined && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={useSessionSignIn}
            className="mt-0.5 size-4 accent-primary"
            onChange={(event) => {
              setUseSessionSignIn(event.target.checked)
              setErrors({})
            }}
          />
          <span>{t('hostForm.useSessionSignIn')}</span>
        </label>
      )}

      {!useSessionSignIn && (
        <>
          <ChoiceGroup
            legend={t('hostForm.signIn')}
            value={method}
            choices={[
              { value: 'password', label: t('hostForm.methodPassword') },
              { value: 'key', label: t('hostForm.methodKey') },
            ]}
            onChange={(value) => {
              setMethod(value)
              setErrors({})
            }}
          />

          {method === 'password' ? (
            <Field
              label={t('hostForm.password')}
              hint={
                savedPassword ? (
                  <span className="flex flex-wrap items-center gap-x-2">
                    {t('hostForm.passwordKeepHint')}
                    <button
                      type="button"
                      className="text-primary underline underline-offset-2"
                      onClick={() => {
                        setForgetPassword(true)
                        setPassword('')
                      }}
                    >
                      {t('hostForm.passwordForget')}
                    </button>
                  </span>
                ) : (
                  t('hostForm.passwordAskHint')
                )
              }
            >
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  type="password"
                  dir="ltr"
                  value={password}
                  autoComplete="new-password"
                  placeholder={savedPassword ? '••••••••' : ''}
                  aria-describedby={describedBy}
                  onChange={(event) => {
                    setPassword(event.target.value)
                  }}
                />
              )}
            </Field>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t('hostForm.keyFile')}</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      void pickKey()
                    }}
                  >
                    <FileKey aria-hidden />
                    {keyFile !== null || savedKey !== undefined
                      ? t('hostForm.keyChange')
                      : t('hostForm.keyChoose')}
                  </Button>
                  <span dir="ltr" className="min-w-0 truncate font-mono text-sm" role="status">
                    {keyFile?.fileName ?? savedKey?.keyName ?? ''}
                  </span>
                </div>
                {errors.key !== undefined && (
                  <p role="alert" className="text-xs text-destructive">
                    {errors.key}
                  </p>
                )}
              </div>
              {needsPassphrase && (
                <Field
                  label={t('hostForm.passphrase')}
                  hint={keyFile === null ? t('hostForm.passphraseKeepHint') : undefined}
                  error={errors.passphrase ?? null}
                >
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      type="password"
                      dir="ltr"
                      value={passphrase}
                      autoComplete="off"
                      aria-invalid={invalid}
                      aria-describedby={describedBy}
                      onChange={(event) => {
                        setPassphrase(event.target.value)
                      }}
                    />
                  )}
                </Field>
              )}
            </>
          )}
        </>
      )}

      <div className="flex flex-col gap-3">
        <button
          type="button"
          aria-expanded={showMore}
          aria-controls={moreId}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          onClick={() => {
            setShowMore((value) => !value)
          }}
        >
          <ChevronDown
            aria-hidden
            className={
              showMore
                ? 'size-4 transition-transform'
                : 'size-4 -rotate-90 transition-transform rtl:rotate-90'
            }
          />
          {t('hostForm.moreOptions')}
        </button>
        <div id={moreId} hidden={!showMore}>
          <Field label={t('hostForm.port')} error={errors.port ?? null}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                dir="ltr"
                inputMode="numeric"
                value={port}
                placeholder={String(DEFAULT_SSH_PORT)}
                aria-invalid={invalid}
                aria-describedby={describedBy}
                className="w-32 font-mono"
                onChange={(event) => {
                  setPort(event.target.value)
                }}
              />
            )}
          </Field>
        </div>
      </div>

      <div className="flex justify-end gap-2 pb-5">
        <Button variant="outline" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={saving}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  )
}

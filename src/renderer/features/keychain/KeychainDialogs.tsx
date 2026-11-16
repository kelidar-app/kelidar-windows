import { FileKey } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { ErrorCode } from '@shared/errors'
import type { KeyFileInfo } from '@shared/hosts'
import { usernameSchema } from '@shared/hosts'
import type { GeneratedKeyType, IdentityView, KeyView } from '@shared/keychain'
import { Button } from '@renderer/components/ui/button'
import { ChoiceGroup } from '@renderer/components/ui/choice-group'
import { Dialog } from '@renderer/components/ui/dialog'
import { FormDialog, FormError } from '@renderer/components/ui/form-dialog'
import { Field } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { api } from '@renderer/lib/api'
import { useKeychainDialogStore, useKeychainStore } from '@renderer/stores/keychain'
import { SignInFields } from './SignInFields'
import { draftToAuth, initialDraft, SIGN_IN_FIELD_ERRORS, type SignInErrors } from './sign-in-draft'
import { UpgradeDialog } from './UpgradeDialog'

/** Renders whichever Keychain dialog is open. */
export function KeychainDialogs() {
  const dialog = useKeychainDialogStore((state) => state.dialog)
  const close = useKeychainDialogStore((state) => state.close)
  switch (dialog.kind) {
    case 'generateKey':
      return <GenerateKeyDialog onDone={close} />
    case 'importKey':
      return <ImportKeyDialog onDone={close} />
    case 'renameKey':
      return <RenameKeyDialog keyView={dialog.key} onDone={close} />
    case 'deleteKey':
      return <DeleteKeyDialog keyView={dialog.key} onDone={close} />
    case 'identity':
      return <IdentityDialog identity={dialog.identity} onDone={close} />
    case 'deleteIdentity':
      return <DeleteIdentityDialog identity={dialog.identity} onDone={close} />
    case 'upgrade':
      return <UpgradeDialog host={dialog.host} onDone={close} />
    case 'none':
      return null
  }
}

function GenerateKeyDialog({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const generate = useKeychainStore((state) => state.generateKey)
  const [name, setName] = useState('')
  const [type, setType] = useState<GeneratedKeyType>('ed25519')
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ name?: string; confirm?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault()
    const next: typeof errors = {}
    if (name.trim() === '') next.name = t('keychain.nameRequired')
    if (passphrase !== confirm) next.confirm = t('keychain.passphraseMismatch')
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setBusy(true)
    const result = await generate({
      name: name.trim(),
      type,
      ...(passphrase === '' ? {} : { passphrase }),
    })
    setBusy(false)
    if (result.ok) onDone()
    else setErrors({ form: t(`errors.${result.code}`) })
  }

  return (
    <FormDialog
      title={t('keychain.generateTitle')}
      description={t('keychain.generateBody')}
      onDone={onDone}
      onSubmit={(event) => {
        void submit(event)
      }}
      busy={busy}
      submitLabel={busy ? t('keychain.generating') : t('keychain.generate')}
    >
      <FormError message={errors.form} />
      <Field label={t('keychain.keyName')} error={errors.name ?? null}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            value={name}
            maxLength={200}
            autoFocus
            data-autofocus
            autoComplete="off"
            placeholder={t('keychain.keyNamePlaceholder')}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            onChange={(event) => {
              setName(event.target.value)
            }}
          />
        )}
      </Field>
      <ChoiceGroup<GeneratedKeyType>
        legend={t('keychain.keyType')}
        hint={type === 'ed25519' ? t('keychain.ed25519Hint') : t('keychain.rsaHint')}
        value={type}
        choices={[
          { value: 'ed25519', label: 'Ed25519' },
          { value: 'rsa', label: 'RSA 4096' },
        ]}
        onChange={setType}
      />
      <Field label={t('keychain.passphraseOptional')} hint={t('keychain.passphraseHint')}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            type="password"
            dir="ltr"
            value={passphrase}
            autoComplete="new-password"
            aria-describedby={describedBy}
            onChange={(event) => {
              setPassphrase(event.target.value)
            }}
          />
        )}
      </Field>
      {passphrase !== '' && (
        <Field label={t('keychain.passphraseConfirm')} error={errors.confirm ?? null}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="password"
              dir="ltr"
              value={confirm}
              autoComplete="new-password"
              aria-invalid={invalid}
              aria-describedby={describedBy}
              onChange={(event) => {
                setConfirm(event.target.value)
              }}
            />
          )}
        </Field>
      )}
    </FormDialog>
  )
}

function ImportKeyDialog({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const importKey = useKeychainStore((state) => state.importKey)
  const [file, setFile] = useState<KeyFileInfo | null>(null)
  const [name, setName] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [errors, setErrors] = useState<{ key?: string; passphrase?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)

  const showError = (code: ErrorCode): void => {
    const field = SIGN_IN_FIELD_ERRORS[code]
    const message = t(`errors.${code}`)
    setErrors(field === undefined ? { form: message } : { [field]: message })
  }

  const pick = async (): Promise<void> => {
    const result = await api.invoke('hosts:pickKeyFile')
    if (!result.ok) {
      showError(result.error.code)
      return
    }
    if (result.data === null) return
    setFile(result.data)
    setName((current) => (current === '' ? (result.data?.fileName ?? '') : current))
    setPassphrase('')
    setErrors({})
  }

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault()
    if (file === null) {
      setErrors({ key: t('errors.KEY_REQUIRED') })
      return
    }
    if (file.encrypted && passphrase === '') {
      setErrors({ passphrase: t('errors.KEY_PASSPHRASE_REQUIRED') })
      return
    }
    setBusy(true)
    const result = await importKey({
      keyFileToken: file.token,
      ...(name.trim() === '' ? {} : { name: name.trim() }),
      ...(file.encrypted ? { passphrase } : {}),
    })
    setBusy(false)
    if (result.ok) onDone()
    else showError(result.code)
  }

  return (
    <FormDialog
      title={t('keychain.importTitle')}
      description={t('keychain.importBody')}
      onDone={onDone}
      onSubmit={(event) => {
        void submit(event)
      }}
      busy={busy}
      submitLabel={t('keychain.import')}
    >
      <FormError message={errors.form} />
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t('hostForm.keyFile')}</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            autoFocus
            data-autofocus
            onClick={() => {
              void pick()
            }}
          >
            <FileKey aria-hidden />
            {file === null ? t('hostForm.keyChoose') : t('hostForm.keyChange')}
          </Button>
          <span dir="ltr" role="status" className="min-w-0 truncate font-mono text-sm">
            {file?.fileName ?? ''}
          </span>
        </div>
        {errors.key !== undefined && (
          <p role="alert" className="text-xs text-destructive">
            {errors.key}
          </p>
        )}
      </div>
      {file !== null && (
        <Field label={t('keychain.keyName')}>
          {({ id }) => (
            <Input
              id={id}
              value={name}
              maxLength={200}
              autoComplete="off"
              onChange={(event) => {
                setName(event.target.value)
              }}
            />
          )}
        </Field>
      )}
      {file?.encrypted === true && (
        <Field
          label={t('hostForm.passphrase')}
          hint={t('hostForm.passphraseStoredHint')}
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
    </FormDialog>
  )
}

function RenameKeyDialog({ keyView, onDone }: { keyView: KeyView; onDone: () => void }) {
  const { t } = useTranslation()
  const rename = useKeychainStore((state) => state.renameKey)
  const [name, setName] = useState(keyView.name)
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault()
    if (name.trim() === '') {
      setError(t('keychain.nameRequired'))
      return
    }
    setBusy(true)
    const result = await rename(keyView.id, name.trim())
    setBusy(false)
    if (result.ok) onDone()
    else setError(t(`errors.${result.code}`))
  }
  return (
    <FormDialog
      title={t('keychain.renameTitle')}
      onDone={onDone}
      onSubmit={(event) => {
        void submit(event)
      }}
      busy={busy}
      submitLabel={t('common.save')}
    >
      <Field label={t('keychain.keyName')} error={error ?? null}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            value={name}
            maxLength={200}
            autoFocus
            data-autofocus
            autoComplete="off"
            aria-invalid={invalid}
            aria-describedby={describedBy}
            onChange={(event) => {
              setName(event.target.value)
            }}
          />
        )}
      </Field>
    </FormDialog>
  )
}

function ConfirmDelete({
  title,
  body,
  confirmLabel,
  onConfirm,
  onDone,
}: {
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => Promise<{ ok: true } | { ok: false; code: ErrorCode }>
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [error, setError] = useState<ErrorCode | null>(null)
  return (
    <Dialog
      open
      onClose={onDone}
      role="alertdialog"
      title={title}
      description={body}
      footer={
        <>
          {error !== null && (
            <p role="alert" className="me-auto text-sm text-destructive">
              {t(`errors.${error}`)}
            </p>
          )}
          <Button variant="outline" autoFocus data-autofocus onClick={onDone}>
            {t('common.cancel')}
          </Button>
          <Button
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              void onConfirm().then((result) => {
                if (result.ok) onDone()
                else setError(result.code)
              })
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  )
}

function DeleteKeyDialog({ keyView, onDone }: { keyView: KeyView; onDone: () => void }) {
  const { t } = useTranslation()
  const deleteKey = useKeychainStore((state) => state.deleteKey)
  return (
    <ConfirmDelete
      title={t('keychain.deleteKeyTitle', { name: keyView.name })}
      body={
        keyView.usedBy > 0
          ? t('keychain.deleteKeyInUse', { count: keyView.usedBy })
          : t('keychain.deleteKeyBody')
      }
      confirmLabel={t('common.delete')}
      onConfirm={() => deleteKey(keyView.id)}
      onDone={onDone}
    />
  )
}

function DeleteIdentityDialog({
  identity,
  onDone,
}: {
  identity: IdentityView
  onDone: () => void
}) {
  const { t } = useTranslation()
  const deleteIdentity = useKeychainStore((state) => state.deleteIdentity)
  return (
    <ConfirmDelete
      title={t('keychain.deleteIdentityTitle', { name: identity.name })}
      body={
        identity.usedBy > 0
          ? t('keychain.deleteIdentityInUse', { count: identity.usedBy })
          : t('keychain.deleteIdentityBody')
      }
      confirmLabel={t('common.delete')}
      onConfirm={() => deleteIdentity(identity.id)}
      onDone={onDone}
    />
  )
}

function IdentityDialog({
  identity,
  onDone,
}: {
  identity: IdentityView | undefined
  onDone: () => void
}) {
  const { t } = useTranslation()
  const saveIdentity = useKeychainStore((state) => state.saveIdentity)
  const [name, setName] = useState(identity?.name ?? '')
  const [username, setUsername] = useState(identity?.username ?? '')
  const [draft, setDraft] = useState(() => initialDraft(identity?.signIn))
  const [errors, setErrors] = useState<
    { name?: string; username?: string; form?: string } & SignInErrors
  >({})
  const [busy, setBusy] = useState(false)

  const showError = (code: ErrorCode): void => {
    const field = SIGN_IN_FIELD_ERRORS[code]
    const message = t(`errors.${code}`)
    setErrors(field === undefined ? { form: message } : { [field]: message })
  }

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault()
    const next: typeof errors = {}
    if (name.trim() === '') next.name = t('keychain.nameRequired')
    if (!usernameSchema.safeParse(username).success) next.username = t('hostForm.usernameInvalid')
    setErrors(next)
    if (Object.keys(next).length > 0) return
    const auth = draftToAuth(draft, identity?.signIn)
    if (!auth.ok) {
      setErrors({
        ...(auth.errors.key === undefined ? {} : { key: t(`errors.${auth.errors.key}`) }),
        ...(auth.errors.passphrase === undefined
          ? {}
          : { passphrase: t(`errors.${auth.errors.passphrase}`) }),
      })
      return
    }
    setBusy(true)
    const result = await saveIdentity({
      ...(identity === undefined ? {} : { id: identity.id }),
      name: name.trim(),
      username: username.trim(),
      auth: auth.auth,
    })
    setBusy(false)
    if (result.ok) onDone()
    else showError(result.code)
  }

  return (
    <FormDialog
      title={identity === undefined ? t('keychain.newIdentity') : t('keychain.editIdentityTitle')}
      description={t('keychain.identityBody')}
      onDone={onDone}
      onSubmit={(event) => {
        void submit(event)
      }}
      busy={busy}
      submitLabel={t('common.save')}
    >
      <FormError message={errors.form} />
      <Field label={t('keychain.identityName')} error={errors.name ?? null}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            value={name}
            maxLength={200}
            autoFocus
            data-autofocus
            autoComplete="off"
            placeholder={t('keychain.identityNamePlaceholder')}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            onChange={(event) => {
              setName(event.target.value)
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
            spellCheck={false}
            autoComplete="off"
            placeholder="deploy"
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className="font-mono"
            onChange={(event) => {
              setUsername(event.target.value)
            }}
          />
        )}
      </Field>
      <SignInFields
        draft={draft}
        onChange={(next) => {
          setDraft(next)
          setErrors({})
        }}
        saved={identity?.signIn}
        errors={errors}
        onError={showError}
      />
    </FormDialog>
  )
}

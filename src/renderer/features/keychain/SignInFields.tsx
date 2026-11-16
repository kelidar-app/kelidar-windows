import { FileKey } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ErrorCode } from '@shared/errors'
import type { SignInView } from '@shared/keychain'
import { Button } from '@renderer/components/ui/button'
import { ChoiceGroup, type Choice } from '@renderer/components/ui/choice-group'
import { Field } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { Select } from '@renderer/components/ui/select'
import { api } from '@renderer/lib/api'
import { useKeychainStore } from '@renderer/stores/keychain'
import type { SignInDraft, SignInErrors } from './sign-in-draft'

/**
 * Password, a key (from the Keychain or a file), or the agent. Used by the
 * host form and the identity form.
 */
export function SignInFields({
  draft,
  onChange,
  saved,
  errors,
  extraChoices = [],
  onExtraChoice,
  onError,
}: {
  draft: SignInDraft
  onChange: (draft: SignInDraft) => void
  saved: SignInView | undefined
  errors: SignInErrors
  /** More methods before the own ones (identity, from the group). */
  extraChoices?: readonly Choice<string>[]
  /** Set when one of the extra choices is selected. */
  onExtraChoice?: { value: string | null; select: (value: string | null) => void }
  onError: (code: ErrorCode) => void
}) {
  const { t } = useTranslation()
  const keys = useKeychainStore((state) => state.keys)
  const update = (patch: Partial<SignInDraft>): void => {
    onChange({ ...draft, ...patch })
  }
  const extraSelected = onExtraChoice?.value ?? null
  const value = extraSelected ?? draft.method
  const savedPassword = saved?.method === 'password' && !draft.forgetPassword

  const pickKeyFile = async (): Promise<void> => {
    const result = await api.invoke('hosts:pickKeyFile')
    if (!result.ok) {
      onError(result.error.code)
      return
    }
    if (result.data !== null) update({ keyFile: result.data, keyId: '', passphrase: '' })
  }

  const choices: Choice<string>[] = [
    ...extraChoices,
    { value: 'password', label: t('hostForm.methodPassword') },
    { value: 'key', label: t('hostForm.methodKey') },
    { value: 'agent', label: t('hostForm.methodAgent') },
  ]

  return (
    <>
      <ChoiceGroup
        legend={t('hostForm.signIn')}
        value={value}
        choices={choices}
        onChange={(next) => {
          if (next === 'password' || next === 'key' || next === 'agent') {
            onExtraChoice?.select(null)
            update({ method: next })
          } else onExtraChoice?.select(next)
        }}
      />

      {extraSelected === null && draft.method === 'password' && (
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
                    update({ forgetPassword: true, password: '' })
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
              value={draft.password}
              autoComplete="new-password"
              placeholder={savedPassword ? '••••••••' : ''}
              aria-describedby={describedBy}
              onChange={(event) => {
                update({ password: event.target.value })
              }}
            />
          )}
        </Field>
      )}

      {extraSelected === null && draft.method === 'key' && (
        <div className="flex flex-col gap-3">
          <Field label={t('hostForm.keyFromKeychain')} error={errors.key ?? null}>
            {({ id, describedBy, invalid }) => (
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  id={id}
                  value={draft.keyFile === null ? draft.keyId : 'file'}
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                  className="min-w-48 flex-1"
                  onChange={(event) => {
                    const next = event.target.value
                    if (next !== 'file') update({ keyId: next, keyFile: null, passphrase: '' })
                  }}
                >
                  <option value="">{t('hostForm.keyNone')}</option>
                  {keys.map((key) => (
                    <option key={key.id} value={key.id}>
                      {t('hostForm.keyOption', { name: key.name, type: key.type })}
                    </option>
                  ))}
                  {draft.keyFile !== null && (
                    <option value="file">
                      {t('hostForm.keyFromFile', { name: draft.keyFile.fileName })}
                    </option>
                  )}
                </Select>
                <Button
                  variant="outline"
                  onClick={() => {
                    void pickKeyFile()
                  }}
                >
                  <FileKey aria-hidden />
                  {t('hostForm.keyChoose')}
                </Button>
              </div>
            )}
          </Field>
          {draft.keyFile?.encrypted === true && (
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
                  value={draft.passphrase}
                  autoComplete="off"
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                  onChange={(event) => {
                    update({ passphrase: event.target.value })
                  }}
                />
              )}
            </Field>
          )}
        </div>
      )}

      {extraSelected === null && draft.method === 'agent' && (
        <p className="text-xs text-muted-foreground">{t('hostForm.agentHint')}</p>
      )}
    </>
  )
}

import { ChevronDown, KeyRound } from 'lucide-react'
import { useEffect, useId, useState, type SyntheticEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { normalizeAddress } from '@shared/address'
import type { ErrorCode } from '@shared/errors'
import { groupDefaultsFor } from '@shared/groups'
import { splitTags, tagListSchema, usernameSchema, type HostSaveRequest } from '@shared/hosts'
import {
  DEFAULT_SSH_PORT,
  ENVIRONMENTS,
  MAX_PORT,
  MAX_TAGS,
  type ColorId,
  type Environment,
} from '@shared/records'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { Field } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { Select } from '@renderer/components/ui/select'
import { SignInFields } from '@renderer/features/keychain/SignInFields'
import {
  draftToAuth,
  initialDraft,
  SIGN_IN_FIELD_ERRORS,
  type SignInErrors,
} from '@renderer/features/keychain/sign-in-draft'
import { useHostFormStore, useHostsStore, type HostFormState } from '@renderer/stores/hosts'
import { useKeychainDialogStore, useKeychainStore } from '@renderer/stores/keychain'
import { useTabsStore } from '@renderer/stores/tabs'
import { ColorPicker } from './ColorPicker'
import { ConnectionFields } from './ConnectionFields'
import {
  connectionRequest,
  hasConnectionOptions,
  initialConnection,
  type ConnectionErrors,
} from './connection-draft'
import { GroupOptions } from './GroupForm'
import { canUpgradeToKey } from './host-keys'

/** Sign-in choices besides a password, key or agent of the host's own. */
type SharedChoice = 'identity' | 'inherit'

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
 * The four fields: name, address, user name and sign-in method. Everything
 * else sits under "More options". Passwords and passphrases live only in this
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
  const groups = useHostsStore((state) => state.groups)
  const hosts = useHostsStore((state) => state.hosts)
  const identities = useKeychainStore((state) => state.identities)
  const loadKeychain = useKeychainStore((state) => state.load)
  const openKeychainDialog = useKeychainDialogStore((state) => state.open)
  const adoptHost = useTabsStore((state) => state.adoptHost)
  const editing = form.mode === 'edit' ? form.host : undefined
  const prefill = form.mode === 'new' ? form.prefill : undefined
  const moreId = useId()

  useEffect(() => {
    void loadKeychain()
  }, [loadKeychain])

  const [name, setName] = useState(editing?.name ?? '')
  const [address, setAddress] = useState(editing?.address ?? prefill?.address ?? '')
  const [username, setUsername] = useState(
    editing?.ownUsername ??
      (editing?.identity === undefined ? editing?.username : '') ??
      prefill?.username ??
      '',
  )
  const sessionId = prefill?.sessionId
  const [useSessionSignIn, setUseSessionSignIn] = useState(sessionId !== undefined)
  const ownSignIn = editing?.identity === undefined ? editing?.signIn : undefined
  const [draft, setDraft] = useState(() => initialDraft(ownSignIn))
  const [groupId, setGroupId] = useState(editing?.groupId ?? prefill?.groupId ?? '')
  const inherited = groupDefaultsFor(groupId === '' ? undefined : groupId, groups)
  const groupIdentity = identities.find((item) => item.id === inherited.identityId.value)
  const [shared, setShared] = useState<SharedChoice | null>(() => {
    if (editing?.identity?.from === 'host') return 'identity'
    if (editing?.identity?.from === 'group') return 'inherit'
    if (editing === undefined && prefill?.sessionId === undefined) {
      const fromGroup = groupDefaultsFor(prefill?.groupId, groups).identityId.value
      if (fromGroup !== undefined) return 'inherit'
    }
    return null
  })
  const [identityId, setIdentityId] = useState(
    editing?.identity?.from === 'host' ? editing.identity.id : '',
  )
  // "From the group" only exists while the chosen group has an identity.
  const sharedChoice: SharedChoice | null =
    shared === 'inherit' && groupIdentity === undefined ? null : shared

  const initialPort =
    editing === undefined
      ? prefill?.port === DEFAULT_SSH_PORT
        ? undefined
        : prefill?.port
      : editing.ownPort
  const [port, setPort] = useState(initialPort === undefined ? '' : String(initialPort))
  const [environment, setEnvironment] = useState<Environment | ''>(editing?.ownEnvironment ?? '')
  const [tags, setTags] = useState(editing?.tags.join(' ') ?? '')
  const [color, setColor] = useState<ColorId | undefined>(editing?.color)
  const [agentForward, setAgentForward] = useState(editing?.agentForward ?? false)
  const [connection, setConnection] = useState(() => initialConnection(editing))
  const [connectionErrors, setConnectionErrors] = useState<ConnectionErrors>({})
  const [showMore, setShowMore] = useState(
    initialPort !== undefined ||
      (editing?.groupId ?? prefill?.groupId) !== undefined ||
      editing?.ownEnvironment !== undefined ||
      (editing?.tags.length ?? 0) > 0 ||
      editing?.color !== undefined ||
      editing?.agentForward === true ||
      hasConnectionOptions(editing),
  )
  const [errors, setErrors] = useState<
    {
      address?: string
      username?: string
      port?: string
      tags?: string
      identity?: string
      form?: string
    } & SignInErrors
  >({})
  const [saving, setSaving] = useState(false)

  const showError = (code: ErrorCode): void => {
    const field = SIGN_IN_FIELD_ERRORS[code]
    const message = t(`errors.${code}`)
    if (code === 'USERNAME_REQUIRED') setErrors({ username: message })
    else if (code === 'IDENTITY_NOT_FOUND') setErrors({ identity: message })
    else setErrors(field === undefined ? { form: message } : { [field]: message })
  }

  const buildAuth = (): HostSaveRequest['auth'] | null => {
    if (useSessionSignIn && sessionId !== undefined) return { type: 'fromSession', sessionId }
    if (sharedChoice === 'inherit') return { type: 'inherit' }
    if (sharedChoice === 'identity') {
      if (identityId === '') {
        setErrors({ identity: t('hostForm.identityRequired') })
        return null
      }
      return { type: 'identity', identityId }
    }
    const result = draftToAuth(draft, ownSignIn)
    if (result.ok) return result.auth
    setErrors({
      ...(result.errors.key === undefined ? {} : { key: t(`errors.${result.errors.key}`) }),
      ...(result.errors.passphrase === undefined
        ? {}
        : { passphrase: t(`errors.${result.errors.passphrase}`) }),
    })
    return null
  }

  const needsUsername = sharedChoice === null || (useSessionSignIn && sessionId !== undefined)

  const onSubmit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault()
    const next: typeof errors = {}
    const cleanAddress = normalizeAddress(address)
    if (cleanAddress === null) next.address = t('hostForm.addressInvalid')
    if (needsUsername && !usernameSchema.safeParse(username).success) {
      next.username = t('hostForm.usernameInvalid')
    }
    const portNumber = port.trim() === '' ? undefined : Number(port)
    if (
      portNumber !== undefined &&
      (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > MAX_PORT)
    ) {
      next.port = t('hostForm.portInvalid', { max: MAX_PORT })
      setShowMore(true)
    }
    const parsedTags = tagListSchema.safeParse(splitTags(tags))
    if (!parsedTags.success) {
      next.tags = t('hostForm.tagsInvalid', { max: MAX_TAGS })
      setShowMore(true)
    }
    const connectionResult = connectionRequest(connection, editing)
    setConnectionErrors(connectionResult.ok ? {} : connectionResult.errors)
    if (!connectionResult.ok) setShowMore(true)
    setErrors(next)
    if (
      Object.keys(next).length > 0 ||
      cleanAddress === null ||
      !parsedTags.success ||
      !connectionResult.ok
    ) {
      return
    }
    const auth = buildAuth()
    if (auth === null) return

    setSaving(true)
    const result = await save({
      ...(editing === undefined ? {} : { id: editing.id }),
      name: name.trim() === '' ? cleanAddress : name.trim(),
      address: cleanAddress,
      ...(portNumber === undefined ? {} : { port: portNumber }),
      ...(groupId === '' ? {} : { groupId }),
      tags: parsedTags.data,
      ...(color === undefined ? {} : { color }),
      ...(environment === '' ? {} : { environment }),
      ...(agentForward ? { agentForward: true } : {}),
      ...connectionResult.fields,
      ...(needsUsername ? { username: username.trim() } : {}),
      auth,
    })
    setSaving(false)
    if (result.ok) {
      if (sessionId !== undefined) adoptHost(sessionId, result.data)
      onDone()
    } else showError(result.code)
  }

  const extraChoices = [
    ...(groupIdentity === undefined
      ? []
      : [{ value: 'inherit', label: t('hostForm.methodInherit', { name: groupIdentity.name }) }]),
    ...(identities.length === 0
      ? []
      : [{ value: 'identity', label: t('hostForm.methodIdentity') }]),
  ]
  const canUpgrade = editing !== undefined && canUpgradeToKey(editing)

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
            data-autofocus
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

      {needsUsername && (
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
      )}

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
          <SignInFields
            draft={draft}
            onChange={(next) => {
              setDraft(next)
              setErrors({})
            }}
            saved={ownSignIn}
            errors={errors}
            extraChoices={extraChoices}
            onExtraChoice={{
              value: sharedChoice,
              select: (value) => {
                setShared(value === 'identity' || value === 'inherit' ? value : null)
                setErrors({})
              },
            }}
            onError={showError}
          />
          {sharedChoice === 'identity' && (
            <Field label={t('hostForm.identity')} error={errors.identity ?? null}>
              {({ id, describedBy, invalid }) => (
                <Select
                  id={id}
                  value={identityId}
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                  onChange={(event) => {
                    setIdentityId(event.target.value)
                  }}
                >
                  <option value="">{t('hostForm.identityChoose')}</option>
                  {identities.map((identity) => (
                    <option key={identity.id} value={identity.id}>
                      {t('hostForm.identityOption', {
                        name: identity.name,
                        username: identity.username,
                      })}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {sharedChoice === 'inherit' && groupIdentity !== undefined && (
            <p className="text-xs text-muted-foreground">
              {t('hostForm.inheritHint', {
                name: groupIdentity.name,
                username: groupIdentity.username,
              })}
            </p>
          )}
        </>
      )}

      {canUpgrade && (
        <div className="flex items-start gap-3 rounded-md border border-border bg-muted p-3">
          <KeyRound aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
            <p className="text-sm">{t('upgrade.offer')}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onDone()
                openKeychainDialog({ kind: 'upgrade', host: editing })
              }}
            >
              {t('upgrade.open')}
            </Button>
          </div>
        </div>
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
        <div id={moreId} hidden={!showMore} className="flex flex-col gap-4">
          <Field label={t('hostForm.group')}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                value={groupId}
                aria-describedby={describedBy}
                onChange={(event) => {
                  setGroupId(event.target.value)
                }}
              >
                <option value="">{t('hostForm.groupNone')}</option>
                <GroupOptions groups={groups} />
              </Select>
            )}
          </Field>
          <Field
            label={t('hostForm.port')}
            hint={
              inherited.port.source.from === 'group'
                ? t('hostForm.portInheritHint', { port: inherited.port.value })
                : undefined
            }
            error={errors.port ?? null}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                dir="ltr"
                inputMode="numeric"
                value={port}
                placeholder={String(inherited.port.value)}
                aria-invalid={invalid}
                aria-describedby={describedBy}
                className="w-32 font-mono"
                onChange={(event) => {
                  setPort(event.target.value)
                }}
              />
            )}
          </Field>
          <ConnectionFields
            draft={connection}
            onChange={setConnection}
            errors={connectionErrors}
            hosts={hosts}
            editing={editing}
            groupJumpName={hosts.find((host) => host.id === inherited.jumpHostId.value)?.name}
          />
          <Field label={t('hostForm.environment')} hint={t('hostForm.environmentHint')}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                value={environment}
                aria-describedby={describedBy}
                className="w-56"
                onChange={(event) => {
                  const value = event.target.value
                  setEnvironment(ENVIRONMENTS.find((item) => item === value) ?? '')
                }}
              >
                <option value="">
                  {inherited.environment.value === undefined
                    ? t('hostForm.environmentNone')
                    : t('hostForm.environmentInherit', {
                        value: t(`environments.${inherited.environment.value}`),
                      })}
                </option>
                {ENVIRONMENTS.map((item) => (
                  <option key={item} value={item}>
                    {t(`environments.${item}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={t('hostForm.tags')}
            hint={t('hostForm.tagsHint')}
            error={errors.tags ?? null}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                value={tags}
                spellCheck={false}
                autoComplete="off"
                placeholder={t('hostForm.tagsPlaceholder')}
                aria-invalid={invalid}
                aria-describedby={describedBy}
                onChange={(event) => {
                  setTags(event.target.value)
                }}
              />
            )}
          </Field>
          <ColorPicker legend={t('hostForm.color')} value={color} onChange={setColor} />
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={agentForward}
              className="mt-0.5 size-4 accent-primary"
              onChange={(event) => {
                setAgentForward(event.target.checked)
              }}
            />
            <span className="flex flex-col gap-0.5">
              <span>{t('hostForm.agentForward')}</span>
              <span className="text-xs text-muted-foreground">
                {t('hostForm.agentForwardHint')}
              </span>
            </span>
          </label>
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

import { ChevronDown } from 'lucide-react'
import { useEffect, useId, useState, type SyntheticEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { groupDefaultsFor, subtreeIds, type GroupView } from '@shared/groups'
import { ENVIRONMENTS, MAX_PORT, type ColorId, type Environment } from '@shared/records'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { Field } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { Select } from '@renderer/components/ui/select'
import { useGroupFormStore, useHostsStore, type GroupFormState } from '@renderer/stores/hosts'
import { useKeychainStore } from '@renderer/stores/keychain'
import { ColorPicker } from './ColorPicker'
import { flattenGroups } from './host-search'

export function GroupFormDialog() {
  const form = useGroupFormStore((state) => state.form)
  const close = useGroupFormStore((state) => state.close)
  const { t } = useTranslation()
  return (
    <Dialog
      open={form.mode !== 'closed'}
      onClose={close}
      title={form.mode === 'edit' ? t('groups.editTitle') : t('groups.newTitle')}
    >
      {form.mode !== 'closed' && <GroupForm form={form} onDone={close} />}
    </Dialog>
  )
}

/** Indented names for a group <select>. */
export function GroupOptions({
  groups,
  exclude,
}: {
  groups: readonly GroupView[]
  exclude?: ReadonlySet<string>
}) {
  return (
    <>
      {flattenGroups(groups)
        .filter(({ group }) => exclude?.has(group.id) !== true)
        .map(({ group, depth }) => (
          <option key={group.id} value={group.id}>
            {`${'   '.repeat(depth)}${group.name}`}
          </option>
        ))}
    </>
  )
}

function GroupForm({
  form,
  onDone,
}: {
  form: Exclude<GroupFormState, { mode: 'closed' }>
  onDone: () => void
}) {
  const { t } = useTranslation()
  const groups = useHostsStore((state) => state.groups)
  const saveGroup = useHostsStore((state) => state.saveGroup)
  const identities = useKeychainStore((state) => state.identities)
  const loadKeychain = useKeychainStore((state) => state.load)
  useEffect(() => {
    void loadKeychain()
  }, [loadKeychain])
  const editing = form.mode === 'edit' ? form.group : undefined
  const moreId = useId()

  const [name, setName] = useState(editing?.name ?? '')
  const [parentId, setParentId] = useState(
    editing?.parentId ?? (form.mode === 'new' ? (form.parentId ?? '') : ''),
  )
  const [color, setColor] = useState<ColorId | undefined>(editing?.color)
  const [port, setPort] = useState(
    editing?.defaults.port === undefined ? '' : String(editing.defaults.port),
  )
  const [environment, setEnvironment] = useState<Environment | ''>(
    editing?.defaults.environment ?? '',
  )
  const [identityId, setIdentityId] = useState(editing?.defaults.identityId ?? '')
  const [showMore, setShowMore] = useState(
    editing?.defaults.port !== undefined ||
      editing?.defaults.environment !== undefined ||
      editing?.defaults.identityId !== undefined,
  )
  const [errors, setErrors] = useState<{ name?: string; port?: string; form?: string }>({})
  const [saving, setSaving] = useState(false)

  const exclude = editing === undefined ? undefined : subtreeIds(editing.id, groups)
  const inherited = groupDefaultsFor(parentId === '' ? undefined : parentId, groups)

  const onSubmit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault()
    const next: typeof errors = {}
    if (name.trim() === '') next.name = t('groups.nameRequired')
    const portNumber = port.trim() === '' ? undefined : Number(port)
    if (
      portNumber !== undefined &&
      (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > MAX_PORT)
    ) {
      next.port = t('hostForm.portInvalid', { max: MAX_PORT })
      setShowMore(true)
    }
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSaving(true)
    const result = await saveGroup({
      ...(editing === undefined ? {} : { id: editing.id }),
      name: name.trim(),
      ...(parentId === '' ? {} : { parentId }),
      ...(color === undefined ? {} : { color }),
      defaults: {
        ...(portNumber === undefined ? {} : { port: portNumber }),
        ...(environment === '' ? {} : { environment }),
        ...(identityId === '' ? {} : { identityId }),
      },
    })
    setSaving(false)
    if (result.ok) onDone()
    else setErrors({ form: t(`errors.${result.code}`) })
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

      <Field label={t('groups.name')} error={errors.name ?? null}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            value={name}
            maxLength={200}
            required
            autoFocus
            data-autofocus
            autoComplete="off"
            placeholder={t('groups.namePlaceholder')}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            onChange={(event) => {
              setName(event.target.value)
            }}
          />
        )}
      </Field>

      <Field label={t('groups.parent')}>
        {({ id, describedBy }) => (
          <Select
            id={id}
            value={parentId}
            aria-describedby={describedBy}
            onChange={(event) => {
              setParentId(event.target.value)
            }}
          >
            <option value="">{t('groups.parentNone')}</option>
            <GroupOptions groups={groups} {...(exclude === undefined ? {} : { exclude })} />
          </Select>
        )}
      </Field>

      <ColorPicker legend={t('groups.color')} value={color} onChange={setColor} />

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
          {t('groups.defaults')}
        </button>
        <div id={moreId} hidden={!showMore} className="flex flex-col gap-4">
          <p className="text-xs text-muted-foreground">{t('groups.defaultsHint')}</p>
          <Field label={t('hostForm.port')} error={errors.port ?? null}>
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
          <Field label={t('hostForm.environment')}>
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
          <Field label={t('groups.identity')} hint={t('groups.identityHint')}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                value={identityId}
                aria-describedby={describedBy}
                onChange={(event) => {
                  setIdentityId(event.target.value)
                }}
              >
                <option value="">
                  {inherited.identityId.value === undefined
                    ? t('groups.identityNone')
                    : t('groups.identityInherit', {
                        name:
                          identities.find((item) => item.id === inherited.identityId.value)?.name ??
                          '',
                      })}
                </option>
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

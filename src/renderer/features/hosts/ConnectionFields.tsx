import { useTranslation } from 'react-i18next'
import type { HostView } from '@shared/hosts'
import { MAX_PORT, type ProxyType } from '@shared/records'
import { Field } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { Select } from '@renderer/components/ui/select'
import {
  PROXY_DEFAULT_PORT,
  stickySessionName,
  type ConnectionDraft,
  type ConnectionErrors,
} from './connection-draft'

/**
 * Jump host, proxy, startup command and sticky session, under "More options"
 * in the host form.
 */
export function ConnectionFields({
  draft,
  onChange,
  errors,
  hosts,
  editing,
  groupJumpName,
}: {
  draft: ConnectionDraft
  onChange: (draft: ConnectionDraft) => void
  errors: ConnectionErrors
  hosts: readonly HostView[]
  editing: HostView | undefined
  /** The jump host the group sets, if any. */
  groupJumpName: string | undefined
}) {
  const { t } = useTranslation()
  const update = (patch: Partial<ConnectionDraft>): void => {
    onChange({ ...draft, ...patch })
  }
  const savedPassword = editing?.proxy?.hasPassword === true && !draft.forgetProxyPassword
  const stickyCommand = `tmux new-session -A -s ${stickySessionName(editing?.id)}`

  return (
    <>
      <Field label={t('hostForm.jumpHost')} hint={t('hostForm.jumpHostHint')}>
        {({ id, describedBy }) => (
          <Select
            id={id}
            value={draft.jump}
            aria-describedby={describedBy}
            onChange={(event) => {
              update({ jump: event.target.value })
            }}
          >
            <option value="">
              {groupJumpName === undefined
                ? t('hostForm.jumpNone')
                : t('hostForm.jumpInherit', { name: groupJumpName })}
            </option>
            {groupJumpName !== undefined && (
              <option value="none">{t('hostForm.jumpDirect')}</option>
            )}
            {hosts
              .filter((host) => host.id !== editing?.id)
              .map((host) => (
                <option key={host.id} value={host.id}>
                  {host.name}
                </option>
              ))}
          </Select>
        )}
      </Field>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">{t('hostForm.proxy')}</legend>
        <Select
          aria-label={t('hostForm.proxyType')}
          value={draft.proxyType}
          className="w-56"
          onChange={(event) => {
            const value = event.target.value
            update({ proxyType: value === 'socks5' || value === 'http' ? value : '' })
          }}
        >
          <option value="">{t('hostForm.proxyNone')}</option>
          <option value="socks5">SOCKS5</option>
          <option value="http">HTTP</option>
        </Select>
        {draft.proxyType !== '' && (
          <ProxyFields
            draft={draft}
            type={draft.proxyType}
            update={update}
            errors={errors}
            savedPassword={savedPassword}
          />
        )}
        {draft.proxyType !== '' &&
          draft.jump !== 'none' &&
          (draft.jump !== '' || groupJumpName !== undefined) && (
            <p className="text-xs text-muted-foreground">{t('hostForm.proxyWithJump')}</p>
          )}
      </fieldset>

      <Field
        label={t('hostForm.startupCommand')}
        hint={t('hostForm.startupHint')}
        error={errors.startup === true ? t('hostForm.startupInvalid') : null}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            dir="ltr"
            value={draft.startup}
            spellCheck={false}
            autoComplete="off"
            placeholder="cd /var/www && git status"
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className="font-mono"
            onChange={(event) => {
              update({ startup: event.target.value })
            }}
          />
        )}
      </Field>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.sticky}
          className="mt-0.5 size-4 accent-primary"
          onChange={(event) => {
            update({ sticky: event.target.checked })
          }}
        />
        <span className="flex flex-col gap-0.5">
          <span>{t('hostForm.sticky')}</span>
          <span className="text-xs text-muted-foreground">{t('hostForm.stickyHint')}</span>
          <code
            dir="ltr"
            className="w-fit rounded bg-muted px-1.5 py-0.5 text-start font-mono text-xs select-text"
          >
            {stickyCommand}
          </code>
        </span>
      </label>
    </>
  )
}

function ProxyFields({
  draft,
  type,
  update,
  errors,
  savedPassword,
}: {
  draft: ConnectionDraft
  type: ProxyType
  update: (patch: Partial<ConnectionDraft>) => void
  errors: ConnectionErrors
  savedPassword: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-[1fr_7rem] gap-3">
      <Field
        label={t('hostForm.proxyHost')}
        error={errors.proxyHost === true ? t('hostForm.addressInvalid') : null}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            dir="ltr"
            value={draft.proxyHost}
            spellCheck={false}
            autoComplete="off"
            placeholder="proxy.example.com"
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className="font-mono"
            onChange={(event) => {
              update({ proxyHost: event.target.value })
            }}
          />
        )}
      </Field>
      <Field
        label={t('hostForm.proxyPort')}
        error={errors.proxyPort === true ? t('hostForm.portInvalid', { max: MAX_PORT }) : null}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            dir="ltr"
            inputMode="numeric"
            value={draft.proxyPort}
            placeholder={String(PROXY_DEFAULT_PORT[type])}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className="font-mono"
            onChange={(event) => {
              update({ proxyPort: event.target.value })
            }}
          />
        )}
      </Field>
      <Field label={t('hostForm.proxyUser')}>
        {({ id }) => (
          <Input
            id={id}
            dir="ltr"
            value={draft.proxyUser}
            spellCheck={false}
            autoComplete="off"
            placeholder={t('hostForm.optional')}
            onChange={(event) => {
              update({ proxyUser: event.target.value })
            }}
          />
        )}
      </Field>
      <Field
        label={t('hostForm.proxyPassword')}
        hint={
          savedPassword ? (
            <button
              type="button"
              className="text-primary underline underline-offset-2"
              onClick={() => {
                update({ forgetProxyPassword: true, proxyPassword: '' })
              }}
            >
              {t('hostForm.proxyForgetPassword')}
            </button>
          ) : undefined
        }
      >
        {({ id, describedBy }) => (
          <Input
            id={id}
            type="password"
            dir="ltr"
            value={draft.proxyPassword}
            autoComplete="new-password"
            placeholder={savedPassword ? '••••••••' : ''}
            aria-describedby={describedBy}
            onChange={(event) => {
              update({ proxyPassword: event.target.value })
            }}
          />
        )}
      </Field>
    </div>
  )
}

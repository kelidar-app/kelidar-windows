import { CircleCheck, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatTarget } from '@shared/address'
import type { ErrorCode } from '@shared/errors'
import type { HostView } from '@shared/hosts'
import type { KeyUpgradePlan } from '@shared/keychain'
import { Button } from '@renderer/components/ui/button'
import { ChoiceGroup } from '@renderer/components/ui/choice-group'
import { Dialog } from '@renderer/components/ui/dialog'
import { Field } from '@renderer/components/ui/field'
import { Select } from '@renderer/components/ui/select'
import { api } from '@renderer/lib/api'
import { useHostsStore } from '@renderer/stores/hosts'
import { useKeychainStore } from '@renderer/stores/keychain'

type KeyChoice = 'ed25519' | 'rsa' | 'existing'

type Step =
  | { kind: 'choose' }
  | { kind: 'preparing' }
  | { kind: 'review'; plan: KeyUpgradePlan }
  | { kind: 'running'; plan: KeyUpgradePlan }
  | { kind: 'done'; host: HostView }

/**
 * Upgrade to key login. Nothing runs on the server until the user has seen
 * the exact command and pressed Run. The host switches to the key only after
 * a test login with the key alone has worked.
 */
export function UpgradeDialog({ host, onDone }: { host: HostView; onDone: () => void }) {
  const { t } = useTranslation()
  const keys = useKeychainStore((state) => state.keys)
  const loadKeychain = useKeychainStore((state) => state.load)
  const loadHosts = useHostsStore((state) => state.load)
  const [choice, setChoice] = useState<KeyChoice>('ed25519')
  const [keyId, setKeyId] = useState('')
  const [step, setStep] = useState<Step>({ kind: 'choose' })
  const [error, setError] = useState<ErrorCode | null>(null)
  const target = formatTarget(host)

  useEffect(() => {
    void loadKeychain()
  }, [loadKeychain])

  const prepare = async (): Promise<void> => {
    if (choice === 'existing' && keyId === '') {
      setError('KEY_REQUIRED')
      return
    }
    setError(null)
    setStep({ kind: 'preparing' })
    const result = await api.invoke('hosts:upgradePrepare', {
      hostId: host.id,
      key: choice === 'existing' ? { keyId } : { generate: choice },
    })
    if (result.ok) setStep({ kind: 'review', plan: result.data })
    else {
      setError(result.error.code)
      setStep({ kind: 'choose' })
    }
  }

  const run = async (plan: KeyUpgradePlan): Promise<void> => {
    setError(null)
    setStep({ kind: 'running', plan })
    const result = await api.invoke('hosts:upgradeRun', { upgradeId: plan.upgradeId })
    await Promise.all([loadHosts(), loadKeychain()])
    if (result.ok) setStep({ kind: 'done', host: result.data })
    else {
      setError(result.error.code)
      // A plan runs once; start again from the key choice.
      setStep({ kind: 'choose' })
    }
  }

  const busy = step.kind === 'preparing' || step.kind === 'running'

  return (
    <Dialog
      open
      onClose={onDone}
      dismissible={!busy}
      title={t('upgrade.title', { name: host.name })}
      description={step.kind === 'done' ? undefined : t('upgrade.body', { target })}
      footer={
        <>
          {step.kind === 'done' ? (
            <Button autoFocus data-autofocus onClick={onDone}>
              {t('common.close')}
            </Button>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={onDone}>
                {t('common.cancel')}
              </Button>
              {step.kind === 'review' || step.kind === 'running' ? (
                <Button
                  disabled={busy}
                  onClick={() => {
                    if (step.kind === 'review') void run(step.plan)
                  }}
                >
                  {busy && <Loader2 aria-hidden className="animate-spin" />}
                  {t('upgrade.run', { target })}
                </Button>
              ) : (
                <Button
                  disabled={busy}
                  onClick={() => {
                    void prepare()
                  }}
                >
                  {busy && <Loader2 aria-hidden className="animate-spin" />}
                  {t('upgrade.showCommand')}
                </Button>
              )}
            </>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error !== null && (
          <p
            role="alert"
            className="rounded-md border border-destructive px-3 py-2 text-sm text-destructive"
          >
            {t(`errors.${error}`)}
          </p>
        )}

        {(step.kind === 'choose' || step.kind === 'preparing') && (
          <>
            <ChoiceGroup<KeyChoice>
              legend={t('upgrade.keyChoice')}
              value={choice}
              choices={[
                { value: 'ed25519', label: t('upgrade.newEd25519') },
                { value: 'rsa', label: t('upgrade.newRsa') },
                ...(keys.length > 0
                  ? [{ value: 'existing' as const, label: t('upgrade.existing') }]
                  : []),
              ]}
              onChange={(next) => {
                setChoice(next)
                setError(null)
              }}
            />
            {choice === 'existing' && (
              <Field label={t('hostForm.keyFromKeychain')}>
                {({ id }) => (
                  <Select
                    id={id}
                    value={keyId}
                    onChange={(event) => {
                      setKeyId(event.target.value)
                    }}
                  >
                    <option value="">{t('hostForm.keyNone')}</option>
                    {keys.map((key) => (
                      <option key={key.id} value={key.id}>
                        {t('hostForm.keyOption', { name: key.name, type: key.type })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <ol className="list-decimal ps-5 text-sm text-muted-foreground">
              <li>{t('upgrade.step1')}</li>
              <li>{t('upgrade.step2')}</li>
              <li>{t('upgrade.step3')}</li>
            </ol>
          </>
        )}

        {(step.kind === 'review' || step.kind === 'running') && (
          <>
            <p className="text-sm">{t('upgrade.commandIntro', { target })}</p>
            <pre
              dir="ltr"
              data-upgrade-command
              className="max-h-48 overflow-auto rounded-md border border-border bg-muted p-3 text-start font-mono text-xs break-all whitespace-pre-wrap select-text"
            >
              {step.plan.command}
            </pre>
            <dl className="flex flex-col gap-1 text-sm">
              <dt className="text-muted-foreground">{t('prompts.fingerprint')}</dt>
              <dd dir="ltr" className="text-start font-mono text-xs break-all select-text">
                {step.plan.fingerprint}
              </dd>
            </dl>
            <p className="text-xs text-muted-foreground">{t('upgrade.passwordStays')}</p>
            {step.kind === 'running' && (
              <p role="status" className="flex items-center gap-2 text-sm">
                <Loader2 aria-hidden className="size-4 animate-spin" />
                {t('upgrade.running')}
              </p>
            )}
          </>
        )}

        {step.kind === 'done' && (
          <div role="status" className="flex items-start gap-3">
            <CircleCheck aria-hidden className="size-6 shrink-0 text-emerald-600" />
            <div className="flex flex-col gap-1 text-sm">
              <p className="font-medium">{t('upgrade.doneTitle')}</p>
              <p className="text-muted-foreground">
                {t('upgrade.doneBody', {
                  name: step.host.name,
                  key: step.host.signIn.method === 'key' ? step.host.signIn.keyName : '',
                })}
              </p>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}

import {
  Check,
  Copy,
  FileKey,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  UserRound,
  Usb,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentSource, KeyView, SignInView } from '@shared/keychain'
import { SHORTCUTS } from '@renderer/app/shortcuts'
import { Button } from '@renderer/components/ui/button'
import { ChoiceGroup } from '@renderer/components/ui/choice-group'
import { api } from '@renderer/lib/api'
import { useKeychainDialogStore, useKeychainStore } from '@renderer/stores/keychain'
import { useSettingsStore } from '@renderer/stores/settings'

/** Identities, keys and the agent: everything a host can sign in with. */
export function KeychainView() {
  const { t } = useTranslation()
  const load = useKeychainStore((state) => state.load)
  const loadAgent = useKeychainStore((state) => state.loadAgent)
  const error = useKeychainStore((state) => state.error)

  useEffect(() => {
    void load()
    void loadAgent()
  }, [load, loadAgent])

  return (
    <section className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-6">
        <h1 className="text-xl font-semibold">{t('keychain.title')}</h1>
        {error !== null && (
          <p
            role="alert"
            className="rounded-md border border-destructive px-3 py-2 text-sm text-destructive"
          >
            {t(`errors.${error}`)}
          </p>
        )}
        <IdentitiesSection />
        <KeysSection />
        <AgentSection />
      </div>
    </section>
  )
}

export function SignInLabel({ signIn }: { signIn: SignInView }) {
  const { t } = useTranslation()
  if (signIn.method === 'key') return <>{t('keychain.signInKey', { name: signIn.keyName })}</>
  if (signIn.method === 'agent') return <>{t('keychain.signInAgent')}</>
  if (signIn.method === 'password') return <>{t('keychain.signInPassword')}</>
  return <>{t('keychain.signInAsk')}</>
}

function SectionHeader({
  title,
  body,
  children,
}: {
  title: string
  body: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex max-w-xl flex-col gap-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
      <div className="flex gap-2">{children}</div>
    </div>
  )
}

function IdentitiesSection() {
  const { t } = useTranslation()
  const identities = useKeychainStore((state) => state.identities)
  const open = useKeychainDialogStore((state) => state.open)
  return (
    <section aria-label={t('keychain.identities')} className="flex flex-col gap-3">
      <SectionHeader title={t('keychain.identities')} body={t('keychain.identitiesBody')}>
        <Button
          title={t('nav.withShortcut', {
            label: t('keychain.newIdentity'),
            shortcut: SHORTCUTS.newIdentity.label,
          })}
          aria-keyshortcuts={SHORTCUTS.newIdentity.aria}
          onClick={() => {
            open({ kind: 'identity' })
          }}
        >
          <Plus aria-hidden />
          {t('keychain.newIdentity')}
        </Button>
      </SectionHeader>
      {identities.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t('keychain.noIdentities')}
        </p>
      ) : (
        <ul aria-label={t('keychain.identities')} className="flex flex-col gap-1.5">
          {identities.map((identity) => (
            <li
              key={identity.id}
              data-identity-id={identity.id}
              className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
            >
              <UserRound aria-hidden className="size-4 shrink-0 text-primary" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{identity.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  <span dir="ltr" className="font-mono">
                    {identity.username}
                  </span>
                  {' · '}
                  <SignInLabel signIn={identity.signIn} />
                </span>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {t('keychain.usedBy', { count: identity.usedBy })}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('keychain.editIdentity', { name: identity.name })}
                title={t('common.edit')}
                onClick={() => {
                  open({ kind: 'identity', identity })
                }}
              >
                <Pencil aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('keychain.deleteIdentity', { name: identity.name })}
                title={t('common.delete')}
                onClick={() => {
                  open({ kind: 'deleteIdentity', identity })
                }}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function KeysSection() {
  const { t } = useTranslation()
  const keys = useKeychainStore((state) => state.keys)
  const open = useKeychainDialogStore((state) => state.open)
  return (
    <section aria-label={t('keychain.keys')} className="flex flex-col gap-3">
      <SectionHeader title={t('keychain.keys')} body={t('keychain.keysBody')}>
        <Button
          variant="outline"
          title={t('nav.withShortcut', {
            label: t('keychain.importKey'),
            shortcut: SHORTCUTS.importKey.label,
          })}
          aria-keyshortcuts={SHORTCUTS.importKey.aria}
          onClick={() => {
            open({ kind: 'importKey' })
          }}
        >
          <FileKey aria-hidden />
          {t('keychain.importKey')}
        </Button>
        <Button
          title={t('nav.withShortcut', {
            label: t('keychain.generateKey'),
            shortcut: SHORTCUTS.generateKey.label,
          })}
          aria-keyshortcuts={SHORTCUTS.generateKey.aria}
          onClick={() => {
            open({ kind: 'generateKey' })
          }}
        >
          <Plus aria-hidden />
          {t('keychain.generateKey')}
        </Button>
      </SectionHeader>
      {keys.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t('keychain.noKeys')}
        </p>
      ) : (
        <ul aria-label={t('keychain.keys')} className="flex flex-col gap-1.5">
          {keys.map((key) => (
            <KeyRow key={key.id} keyView={key} />
          ))}
        </ul>
      )}
    </section>
  )
}

function KeyRow({ keyView: key }: { keyView: KeyView }) {
  const { t } = useTranslation()
  const open = useKeychainDialogStore((state) => state.open)
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    const result = await api.invoke('clipboard:writeText', { text: `${key.publicKey} ${key.name}` })
    if (!result.ok) return
    setCopied(true)
    window.setTimeout(() => {
      setCopied(false)
    }, 2000)
  }
  return (
    <li
      data-key-id={key.id}
      className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
    >
      <KeyRound aria-hidden className="size-4 shrink-0 text-primary" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2 truncate text-sm font-medium">
          {key.name}
          <span className="rounded bg-muted px-1.5 py-px text-[0.6875rem] font-normal text-muted-foreground uppercase">
            {key.type}
          </span>
          {key.hasPassphrase && (
            <span className="text-xs font-normal text-muted-foreground">
              {t('keychain.hasPassphrase')}
            </span>
          )}
        </span>
        <span
          dir="ltr"
          className="truncate text-start font-mono text-xs text-muted-foreground select-text"
          data-fingerprint
        >
          {key.fingerprint}
        </span>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        {t('keychain.usedBy', { count: key.usedBy })}
      </span>
      <Button
        variant="outline"
        size="sm"
        aria-label={t('keychain.copyPublicKeyOf', { name: key.name })}
        onClick={() => {
          void copy()
        }}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        <span role="status">{copied ? t('keychain.copied') : t('keychain.copyPublicKey')}</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('keychain.renameKey', { name: key.name })}
        title={t('keychain.rename')}
        onClick={() => {
          open({ kind: 'renameKey', key })
        }}
      >
        <Pencil aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('keychain.deleteKey', { name: key.name })}
        title={t('common.delete')}
        onClick={() => {
          open({ kind: 'deleteKey', key })
        }}
      >
        <Trash2 aria-hidden />
      </Button>
    </li>
  )
}

function AgentSection() {
  const { t } = useTranslation()
  const agent = useKeychainStore((state) => state.agent)
  const loadAgent = useKeychainStore((state) => state.loadAgent)
  const source = useSettingsStore((state) => state.settings.agent)
  const update = useSettingsStore((state) => state.update)
  const probe = (running: boolean, keys: number | null): string =>
    running ? t('keychain.agentRunning', { count: keys ?? 0 }) : t('keychain.agentStopped')

  return (
    <section aria-label={t('keychain.agent')} className="flex flex-col gap-3">
      <SectionHeader title={t('keychain.agent')} body={t('keychain.agentBody')}>
        <Button
          variant="outline"
          onClick={() => {
            void loadAgent()
          }}
        >
          <RefreshCw aria-hidden />
          {t('keychain.agentRefresh')}
        </Button>
      </SectionHeader>
      <div className="flex flex-col gap-4 rounded-md border border-border bg-card p-4">
        <ChoiceGroup<AgentSource>
          legend={t('keychain.agentSource')}
          value={source}
          choices={[
            { value: 'auto', label: t('keychain.agentAuto') },
            { value: 'openssh', label: t('keychain.agentOpenssh') },
            { value: 'pageant', label: t('keychain.agentPageant') },
          ]}
          onChange={(agentSource) => {
            void update({ agent: agentSource }).then(() => loadAgent())
          }}
        />
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm" role="status">
          <dt className="flex items-center gap-2 text-muted-foreground">
            <Usb aria-hidden className="size-4" />
            {t('keychain.agentOpenssh')}
          </dt>
          <dd>{agent === null ? '…' : probe(agent.openssh.running, agent.openssh.keys)}</dd>
          <dt className="flex items-center gap-2 text-muted-foreground">
            <Usb aria-hidden className="size-4" />
            {t('keychain.agentPageant')}
          </dt>
          <dd>{agent === null ? '…' : probe(agent.pageant.running, agent.pageant.keys)}</dd>
        </dl>
        {agent !== null && agent.active === null && (
          <p className="text-xs text-muted-foreground">{t('keychain.agentNoneHint')}</p>
        )}
      </div>
    </section>
  )
}

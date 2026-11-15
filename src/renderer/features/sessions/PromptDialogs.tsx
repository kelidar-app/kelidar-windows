import { ShieldQuestion } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatTarget } from '@shared/address'
import type { PromptRequest } from '@shared/session'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { Field } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { usePromptsStore } from '@renderer/stores/prompts'

/** Shows the oldest open question from main. */
export function PromptDialogs() {
  const current = usePromptsStore((state) => state.queue[0])
  if (current === undefined) return null
  // A new key per prompt resets typed values between questions.
  if (current.kind === 'hostKey') return <HostKeyDialog key={current.promptId} prompt={current} />
  if (current.kind === 'password' || current.kind === 'passphrase') {
    return <SecretDialog key={current.promptId} prompt={current} />
  }
  return <KeyboardDialog key={current.promptId} prompt={current} />
}

function HostKeyDialog({ prompt }: { prompt: Extract<PromptRequest, { kind: 'hostKey' }> }) {
  const { t } = useTranslation()
  const answer = usePromptsStore((state) => state.answer)
  const reject = (): void => {
    answer(prompt.promptId, { kind: 'hostKey', trust: false })
  }
  return (
    <Dialog
      open
      onClose={reject}
      role="alertdialog"
      title={t('prompts.hostKeyTitle')}
      description={t('prompts.hostKeyBody', {
        target: formatTarget({ address: prompt.host, port: prompt.port }),
      })}
      footer={
        <>
          <Button variant="outline" autoFocus onClick={reject}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => {
              answer(prompt.promptId, { kind: 'hostKey', trust: true })
            }}
          >
            {t('prompts.hostKeyTrust')}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3 rounded-md border border-border bg-muted p-3">
        <ShieldQuestion aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
        <dl className="flex min-w-0 flex-col gap-1 text-sm">
          <dt className="text-muted-foreground">{t('prompts.fingerprint')}</dt>
          <dd dir="ltr" className="font-mono text-start break-all select-text" data-fingerprint>
            {prompt.fingerprint}
          </dd>
          <dt className="mt-1 text-muted-foreground">{t('prompts.keyType')}</dt>
          <dd dir="ltr" className="font-mono text-start">
            {prompt.keyType}
          </dd>
        </dl>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{t('prompts.hostKeyHint')}</p>
    </Dialog>
  )
}

/** A password for the server, or the passphrase of a key file. */
function SecretDialog({
  prompt,
}: {
  prompt: Extract<PromptRequest, { kind: 'password' | 'passphrase' }>
}) {
  const { t } = useTranslation()
  const answer = usePromptsStore((state) => state.answer)
  const [value, setValue] = useState('')
  const formId = `prompt-${prompt.promptId}`
  const kind = prompt.kind
  const cancel = (): void => {
    answer(prompt.promptId, { kind, value: null })
  }
  const title =
    prompt.kind === 'password'
      ? t('prompts.passwordTitle', {
          target: formatTarget({ username: prompt.username, address: prompt.host, port: 22 }),
        })
      : t('prompts.passphraseTitle', { keyName: prompt.keyName })
  const retry = kind === 'password' ? t('prompts.passwordRetry') : t('prompts.passphraseRetry')
  return (
    <Dialog
      open
      onClose={cancel}
      title={title}
      description={prompt.attempt > 0 ? retry : undefined}
      footer={
        <>
          <Button variant="outline" onClick={cancel}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId}>
            {t('prompts.connect')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault()
          answer(prompt.promptId, { kind, value })
        }}
      >
        <Field label={kind === 'password' ? t('hostForm.password') : t('hostForm.passphrase')}>
          {({ id }) => (
            <Input
              id={id}
              type="password"
              dir="ltr"
              autoFocus
              autoComplete="off"
              value={value}
              onChange={(event) => {
                setValue(event.target.value)
              }}
            />
          )}
        </Field>
      </form>
    </Dialog>
  )
}

function KeyboardDialog({
  prompt,
}: {
  prompt: Extract<PromptRequest, { kind: 'keyboardInteractive' }>
}) {
  const { t } = useTranslation()
  const answer = usePromptsStore((state) => state.answer)
  const [values, setValues] = useState(() => prompt.prompts.map(() => ''))
  const formId = `prompt-${prompt.promptId}`
  const cancel = (): void => {
    answer(prompt.promptId, { kind: 'keyboardInteractive', values: null })
  }
  // Text from the server: plain text with its own direction, never markup.
  const intro = [prompt.name, prompt.instructions].filter((part) => part.trim() !== '')
  return (
    <Dialog
      open
      onClose={cancel}
      title={t('prompts.keyboardTitle', { host: prompt.host })}
      description={
        intro.length === 0 ? undefined : (
          <span dir="auto" className="whitespace-pre-wrap">
            {intro.join('\n')}
          </span>
        )
      }
      footer={
        <>
          <Button variant="outline" onClick={cancel}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId}>
            {t('prompts.send')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          answer(prompt.promptId, { kind: 'keyboardInteractive', values })
        }}
      >
        {prompt.prompts.map((question, index) => (
          <Field
            key={index}
            label={question.text.trim() === '' ? t('prompts.answer') : question.text}
          >
            {({ id }) => (
              <Input
                id={id}
                type={question.echo ? 'text' : 'password'}
                dir="ltr"
                autoFocus={index === 0}
                autoComplete="off"
                value={values[index] ?? ''}
                onChange={(event) => {
                  const next = [...values]
                  next[index] = event.target.value
                  setValues(next)
                }}
              />
            )}
          </Field>
        ))}
      </form>
    </Dialog>
  )
}

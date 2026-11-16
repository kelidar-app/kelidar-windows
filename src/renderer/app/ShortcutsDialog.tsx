import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { HOST_KEYS } from '@renderer/features/hosts/host-keys'
import { useUiStore } from '@renderer/stores/ui'
import { COMMANDS, comboLabel, type CommandSection } from './commands'

const SECTIONS: readonly CommandSection[] = ['general', 'hosts', 'tabs']

function Keys({ keys }: { keys: readonly string[] }) {
  return (
    <span dir="ltr" className="flex shrink-0 flex-wrap justify-end gap-1">
      {keys.map((key) => (
        <kbd
          key={key}
          className="rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-xs whitespace-nowrap"
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}

function Row({ label, keys, note }: { label: string; keys: readonly string[]; note?: string }) {
  return (
    <li className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="flex flex-col">
        <span>{label}</span>
        {note !== undefined && <span className="text-xs text-muted-foreground">{note}</span>}
      </span>
      <Keys keys={keys} />
    </li>
  )
}

/** Every shortcut, read from the same list the keyboard handler uses. */
export function ShortcutsDialog() {
  const { t } = useTranslation()
  const open = useUiStore((state) => state.shortcutsOpen)
  const setOpen = useUiStore((state) => state.setShortcutsOpen)
  const close = (): void => {
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('shortcuts.title')}
      description={t('shortcuts.body')}
      className="w-[min(40rem,calc(100vw-2rem))]"
      footer={
        <Button autoFocus data-autofocus onClick={close}>
          {t('common.close')}
        </Button>
      }
    >
      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {SECTIONS.map((section) => (
          <section key={section} aria-labelledby={`shortcuts-${section}`}>
            <h3 id={`shortcuts-${section}`} className="text-xs font-semibold text-muted-foreground">
              {t(`shortcuts.sections.${section}`)}
            </h3>
            <ul className="divide-y divide-border">
              {COMMANDS.filter((command) => command.section === section).map((command) => {
                const outside = command.combos.some((combo) => combo.outsideTerminal === true)
                return (
                  <Row
                    key={command.id}
                    label={t(`commands.${command.id}`)}
                    keys={command.combos.map(comboLabel)}
                    {...(outside ? { note: t('shortcuts.outsideTerminal') } : {})}
                  />
                )
              })}
            </ul>
          </section>
        ))}
        <section aria-labelledby="shortcuts-host-list">
          <h3 id="shortcuts-host-list" className="text-xs font-semibold text-muted-foreground">
            {t('shortcuts.sections.hostList')}
          </h3>
          <ul className="divide-y divide-border">
            <Row label={t('hosts.connectShort')} keys={[HOST_KEYS.connect]} />
            <Row label={t('common.edit')} keys={[HOST_KEYS.edit]} />
            <Row label={t('shortcuts.favorite')} keys={[HOST_KEYS.favorite]} />
            <Row label={t('common.delete')} keys={[HOST_KEYS.remove]} />
            <Row label={t('shortcuts.moveFocus')} keys={[HOST_KEYS.move]} />
          </ul>
        </section>
        <section aria-labelledby="shortcuts-palette">
          <h3 id="shortcuts-palette" className="text-xs font-semibold text-muted-foreground">
            {t('shortcuts.sections.palette')}
          </h3>
          <ul className="divide-y divide-border">
            <Row label={t('shortcuts.paletteRun')} keys={['Enter']} />
            <Row label={t('shortcuts.paletteHostActions')} keys={['Shift+Enter']} />
            <Row label={t('shortcuts.paletteBack')} keys={['Backspace']} />
            <Row label={t('common.close')} keys={['Esc']} />
          </ul>
        </section>
      </div>
    </Dialog>
  )
}

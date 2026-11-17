import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { useTabsStore } from '@renderer/stores/tabs'
import { useUpdatesStore } from '@renderer/stores/updates'

/** "Restart to update" with terminals open: they close (sticky sessions resume afterwards). */
export function RestartDialog() {
  const { t } = useTranslation()
  const confirming = useUpdatesStore((state) => state.confirming)
  const confirm = useUpdatesStore((state) => state.confirmRestart)
  const cancel = useUpdatesStore((state) => state.cancelRestart)
  const tabs = useTabsStore((state) => state.tabs.length)
  return (
    <Dialog
      open={confirming}
      onClose={cancel}
      role="alertdialog"
      title={t('updates.confirmTitle')}
      description={t('updates.confirmBody', { count: tabs })}
      footer={
        <>
          <Button variant="outline" data-autofocus onClick={cancel}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void confirm()}>{t('updates.restart')}</Button>
        </>
      }
    />
  )
}

import { Ban } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { COLORS, type ColorId } from '@shared/records'
import { cn } from '@renderer/lib/cn'
import { COLOR_DOT } from './colors'

/** Radio buttons drawn as color swatches, plus "No color". */
export function ColorPicker({
  legend,
  value,
  onChange,
}: {
  legend: string
  value: ColorId | undefined
  onChange: (value: ColorId | undefined) => void
}) {
  const { t } = useTranslation()
  const name = useId()
  const choices: (ColorId | 'none')[] = ['none', ...COLORS]
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {choices.map((choice) => {
          const checked = (value ?? 'none') === choice
          const label = choice === 'none' ? t('colors.none') : t(`colors.${choice}`)
          return (
            <label
              key={choice}
              title={label}
              className={cn(
                'flex size-7 cursor-pointer items-center justify-center rounded-full border-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring',
                checked ? 'border-foreground' : 'border-transparent',
              )}
            >
              <input
                type="radio"
                name={name}
                value={choice}
                checked={checked}
                aria-label={label}
                className="sr-only"
                onChange={() => {
                  onChange(choice === 'none' ? undefined : choice)
                }}
              />
              {choice === 'none' ? (
                <Ban aria-hidden className="size-5 text-muted-foreground" />
              ) : (
                <span aria-hidden className={cn('size-5 rounded-full', COLOR_DOT[choice])} />
              )}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

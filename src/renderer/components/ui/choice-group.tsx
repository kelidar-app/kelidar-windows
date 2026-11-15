import { useId } from 'react'
import { cn } from '@renderer/lib/cn'

export interface Choice<T extends string> {
  value: T
  label: string
  /** BCP 47 language of the label, for labels written in another language. */
  lang?: string
}

interface ChoiceGroupProps<T extends string> {
  legend: string
  hint?: string
  value: T
  choices: readonly Choice<T>[]
  onChange: (value: T) => void
}

/** A row of radio buttons styled as a segmented control. Native inputs keep it accessible. */
export function ChoiceGroup<T extends string>({
  legend,
  hint,
  value,
  choices,
  onChange,
}: ChoiceGroupProps<T>) {
  const name = useId()
  const hintId = `${name}-hint`
  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-describedby={hint === undefined ? undefined : hintId}
    >
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="inline-flex w-fit flex-wrap gap-1 rounded-lg border border-border bg-muted p-1">
        {choices.map((choice) => {
          const id = `${name}-${choice.value}`
          const checked = choice.value === value
          return (
            <label
              key={choice.value}
              htmlFor={id}
              lang={choice.lang}
              className={cn(
                'cursor-pointer rounded-md px-3 py-1.5 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring',
                checked
                  ? 'bg-card text-card-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={choice.value}
                checked={checked}
                onChange={() => {
                  onChange(choice.value)
                }}
                className="sr-only"
              />
              {choice.label}
            </label>
          )
        })}
      </div>
      {hint !== undefined && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </fieldset>
  )
}

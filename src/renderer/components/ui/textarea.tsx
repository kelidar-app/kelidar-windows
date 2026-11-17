import type { ComponentProps } from 'react'
import { cn } from '@renderer/lib/cn'

/** A multi-line text field, styled like Input. */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'min-h-24 w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 text-sm text-card-foreground placeholder:text-muted-foreground disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

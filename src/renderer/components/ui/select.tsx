import type { ComponentProps } from 'react'
import { cn } from '@renderer/lib/cn'

/** A native select, styled like Input. Native keeps keyboard and screen reader support. */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-9 w-full min-w-0 rounded-md border border-input bg-card px-2 text-sm text-card-foreground disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

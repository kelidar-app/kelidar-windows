import { Server } from 'lucide-react'
import type { HostOs, OsId } from '@shared/host-extras'
import { cn } from '@renderer/lib/cn'

/** Each system's usual color, for its badge. Full class names so Tailwind finds them. */
const OS_STYLE: Record<OsId, { label: string; className: string }> = {
  ubuntu: { label: 'U', className: 'bg-orange-600 text-white' },
  debian: { label: 'D', className: 'bg-rose-700 text-white' },
  fedora: { label: 'F', className: 'bg-blue-700 text-white' },
  centos: { label: 'C', className: 'bg-violet-700 text-white' },
  rhel: { label: 'R', className: 'bg-red-700 text-white' },
  rocky: { label: 'R', className: 'bg-emerald-600 text-white' },
  almalinux: { label: 'A', className: 'bg-sky-600 text-white' },
  alpine: { label: 'A', className: 'bg-blue-900 text-white' },
  arch: { label: 'A', className: 'bg-sky-500 text-white' },
  opensuse: { label: 'S', className: 'bg-lime-600 text-white' },
  amazon: { label: 'A', className: 'bg-amber-500 text-black' },
  oracle: { label: 'O', className: 'bg-red-600 text-white' },
  mint: { label: 'M', className: 'bg-green-600 text-white' },
  kali: { label: 'K', className: 'bg-slate-800 text-white' },
  raspbian: { label: 'R', className: 'bg-pink-700 text-white' },
  freebsd: { label: 'B', className: 'bg-red-800 text-white' },
  linux: { label: 'L', className: 'bg-gray-700 text-white' },
}

/**
 * The host's icon: its system (read after the first connection) as a
 * colored letter with the full name as a tooltip, or a server icon before
 * that. No trademarked logos.
 */
export function OsBadge({ os, className }: { os: HostOs | undefined; className?: string }) {
  if (os === undefined) {
    return (
      <div
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground',
          className,
        )}
      >
        <Server aria-hidden className="size-4" />
      </div>
    )
  }
  const style = OS_STYLE[os.id]
  return (
    <div
      role="img"
      aria-label={os.name}
      title={os.name}
      data-os={os.id}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-semibold',
        style.className,
        className,
      )}
    >
      {style.label}
    </div>
  )
}

import type { ColorId, Environment } from '@shared/records'

/** Full class names, so Tailwind finds them. */
export const COLOR_DOT: Record<ColorId, string> = {
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  amber: 'bg-amber-400',
  green: 'bg-green-500',
  teal: 'bg-teal-500',
  blue: 'bg-blue-500',
  violet: 'bg-violet-500',
  pink: 'bg-pink-500',
  gray: 'bg-gray-400',
}

/** The colored edge on a host card or row. */
export const COLOR_EDGE: Record<ColorId, string> = {
  red: 'border-s-red-500',
  orange: 'border-s-orange-500',
  amber: 'border-s-amber-400',
  green: 'border-s-green-500',
  teal: 'border-s-teal-500',
  blue: 'border-s-blue-500',
  violet: 'border-s-violet-500',
  pink: 'border-s-pink-500',
  gray: 'border-s-gray-400',
}

export const ENVIRONMENT_BADGE: Record<Environment, string> = {
  production: 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300',
  staging: 'border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200',
  development: 'border-green-500/50 bg-green-500/10 text-green-800 dark:text-green-200',
}

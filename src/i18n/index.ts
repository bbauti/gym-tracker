import { getLocales } from 'expo-localization'
import en from './en'
import es from './es'

export type Locale = 'es' | 'en'
export type TKey = keyof typeof es

// ponytail: idioma del dispositivo, fijo por sesión. Techo: `settings.locale` no se respeta y
// cambiarlo pide reiniciar. Upgrade: mover `locale` a un useSyncExternalStore leído de settings.
export const locale: Locale = getLocales()[0].languageCode === 'es' ? 'es' : 'en'

const dict: Record<TKey, string> = locale === 'es' ? es : en

export function t(key: TKey, vars?: Record<string, string | number>): string {
  const s = dict[key]
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (whole, name: string) => String(vars[name] ?? whole))
}

/** es y en comparten la regla 1/otros; Intl.PluralRules no está garantizada en Hermes. */
export function plural(n: number, one: string, other: string): string {
  return n === 1 ? one : other
}

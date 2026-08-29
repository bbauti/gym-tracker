import { getLocales } from 'expo-localization'
import Storage from 'expo-sqlite/kv-store'
import en from './en'
import es from './es'

export type Locale = 'es' | 'en'
export type TKey = keyof typeof es

// ponytail: idioma del dispositivo, fijo por sesión. Techo: `settings.locale` no se respeta y
// cambiarlo pide reiniciar. Upgrade: mover `locale` a un useSyncExternalStore leído de settings.
const LOCALE_KEY = 'locale'

/**
 * La preferencia vive en el kv-store de expo-sqlite (sync) y no en `settings`: este módulo se importa
 * antes de que exista la base y no puede depender de ella. Se lee una vez, al arrancar: cambiarla
 * se aplica al reabrir la app (25 archivos formatean fechas con `locale` como constante).
 */
function storedLocale(): Locale | null {
  try {
    const v = Storage.getItemSync(LOCALE_KEY)
    return v === 'es' || v === 'en' ? v : null
  } catch {
    return null // bun:test y web: sin módulo nativo, sin preferencia
  }
}

export function getLocalePreference(): Locale | null {
  return storedLocale()
}

/** `null` = seguir al sistema. */
export function setLocalePreference(value: Locale | null): void {
  if (value) Storage.setItemSync(LOCALE_KEY, value)
  else Storage.removeItemSync(LOCALE_KEY)
}

export const locale: Locale =
  storedLocale() ?? (getLocales()[0].languageCode === 'es' ? 'es' : 'en')

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

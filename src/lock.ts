/**
 * Bloqueo de la app (L10). Único archivo que importa `expo-local-authentication`: el resto llama
 * estas dos funciones, que nunca tiran (el módulo nativo no existe en los tests ni en web, y un
 * error del sensor no puede dejar la app encerrada).
 */
import * as LocalAuthentication from 'expo-local-authentication'
import { t } from '@/i18n'

let cached: boolean | null = null

/**
 * Lo último que contestó `available()`, o null si todavía no corrió. Son dos saltos al nativo: sin
 * cache, la fila de Ajustes se pinta deshabilitada y se enciende un par de frames después, cada vez.
 */
export function availableSync(): boolean | null {
  return cached
}

/** Hardware + algo enrolado. Sin las dos, el switch de Ajustes se deshabilita y se fuerza en off. */
export async function available(): Promise<boolean> {
  try {
    cached =
      (await LocalAuthentication.hasHardwareAsync()) &&
      (await LocalAuthentication.isEnrolledAsync())
  } catch {
    cached = false
  }
  return cached
}

/**
 * `disableDeviceFallback: false` a propósito: si la biometría falla (guantes, cara tapada en el
 * gimnasio) el sistema ofrece el PIN. Sin eso, el único camino de vuelta sería reinstalar.
 */
export async function unlock(): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: t('lock.prompt'),
      cancelLabel: t('common.cancel'),
      disableDeviceFallback: false,
    })
    return result.success
  } catch {
    return false
  }
}

/**
 * Atajos del ícono de la app (L09/K15): mantener apretada la app en la pantalla de inicio abre
 * "Entrenamiento libre", que entra derecho al entrenamiento sin pasar por la pestaña.
 *
 * Único archivo que importa `expo-quick-actions`: la llamada nunca tira (el módulo nativo no existe
 * en los tests, y en Android < 7.1 no hay atajos) y no vale la pena reintentar — el sistema se queda
 * con los últimos que le pasaron.
 *
 * El destino viaja como `params.href`: es la convención que entiende `useQuickActionRouting()` del
 * layout raíz, y `/start` es un desvío, no una pantalla (ver `app/start.tsx`).
 */
import * as QuickActions from 'expo-quick-actions'
import { Platform } from 'react-native'
import { t } from '@/i18n'

/**
 * En iOS el ícono es un SF Symbol dinámico. En Android es el nombre del recurso que genera el config
 * plugin desde `app.json` (`androidIcons.quick_free` → `mipmap/quick_free`) y el nativo lo busca por
 * nombre en tiempo de ejecución: si dejan de coincidir, el atajo aparece sin ícono y sin avisar.
 */
const icon = Platform.select({
  android: 'quick_free',
  ios: 'symbol:figure.strengthtraining.traditional',
})

/** Se llama una vez desde el Gate del layout raíz, ya con la base lista. */
export function setup(): void {
  QuickActions.setItems([
    { icon, id: 'free', params: { href: '/start' }, title: t('quick.free') },
  ]).catch(() => {})
}

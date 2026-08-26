import { Platform } from 'react-native'
import { useKeyboardState } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

const ANDROID = Platform.OS === 'android'

/**
 * Prop `enabled` de la KeyboardAvoidingView de una hoja: en Android va apagada.
 *
 * Ahí la hoja no se achica ni se corre con el teclado — react-native-screens la deja donde está y
 * el IME le tapa la parte de abajo (`SheetDelegate`, `KeyboardVisible`) — y encima la KAV mide su
 * frame una sola vez, con la hoja todavía a medio detent, así que el colchón que calcula no tiene
 * nada que ver con el teclado: o pone de más (banda gris) o no pone nada.
 *
 * El hueco lo pone entonces el propio contenido (`useSheetBottomInset`): una hoja `fitToContents`
 * crece con él y RN Screens la vuelve a medir, así que el botón sube en vez de quedar debajo del
 * teclado. En iOS la hoja sí se achica sola y la KAV mide bien: se queda como estaba.
 */
export const KAV_ENABLED = !ANDROID

/** Alto del teclado abierto en Android; 0 en iOS, donde el hueco lo pone la KAV. */
export function useAndroidKeyboardHeight(): number {
  return useKeyboardState((s) => (ANDROID && s.isVisible ? s.height : 0))
}

/**
 * Hueco de abajo de una hoja. Con el teclado abierto en Android reemplaza al safe area en vez de
 * sumarse: el inset del IME ya incluye la barra de navegación.
 */
export function useSheetBottomInset(): number {
  const insets = useSafeAreaInsets()
  return useAndroidKeyboardHeight() || insets.bottom
}

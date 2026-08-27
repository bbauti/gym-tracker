import Constants from 'expo-constants'
import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import { StyleSheet, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { t } from '@/i18n'
import Button from './Button'
import { Exit } from './motion'
import Text from './Text'
import { colors, spacing } from './tokens'

type Props = {
  onUnlock: () => void
  /** Con el diálogo del sistema abierto: el botón no puede pedir una segunda autenticación. */
  busy: boolean
  /** Ya hubo un intento (el automático, o uno cancelado): el botón deja de ser el primer paso. */
  failed: boolean
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[5],
    backgroundColor: colors.groupedBackground,
  },
  // El hero es el único control de la pantalla: ocupa el ancho, no el de su texto.
  cta: { alignSelf: 'stretch', paddingTop: spacing[2] },
})

/**
 * Tapa la app entera cuando el bloqueo está activo (L10). Es un hermano del Stack en el layout raíz,
 * no una ruta: la navegación de abajo queda como estaba y volver no la esquiva.
 * `accessibilityViewIsModal` saca lo de atrás del alcance de VoiceOver; en Android eso no existe y
 * lo resuelve el layout raíz escondiendo el Stack con `importantForAccessibility`.
 * Sin `entering`: aparece en el arranque en frío y al volver de background, y un fade ahí sería
 * justo el frame de contenido que el bloqueo tiene que esconder. Solo se anima la salida (§7.5).
 */
export default function LockScreen({ onUnlock, busy, failed }: Props) {
  return (
    <Animated.View
      accessibilityViewIsModal
      exiting={Exit.fade}
      style={[StyleSheet.absoluteFill, styles.wrap]}
    >
      {/* Decorativo: el estado ya lo dice el texto de abajo. En Android el símbolo es un <Text> con
          un codepoint privado, así que sin el wrapper TalkBack para en un carácter impronunciable. */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <SymbolView
          fallback={null}
          name={{ ios: 'lock.fill' as SFSymbol, android: 'lock' as AndroidSymbol }}
          size={44}
          tintColor={colors.tertiaryLabel}
        />
      </View>
      <Text accessibilityRole="header" role="titleEmphasized">
        {Constants.expoConfig?.name ?? 'Gym Tracker'}
      </Text>
      <Text color="secondary">{t('lock.locked')}</Text>
      <View style={styles.cta}>
        <Button
          disabled={busy}
          onPress={onUnlock}
          title={t(failed ? 'lock.retry' : 'lock.unlock')}
          variant="hero"
        />
      </View>
    </Animated.View>
  )
}

import { type ReactNode, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { t } from '@/i18n'
import { haptic } from './haptics'
import PressableScale from './PressableScale'
import Text from './Text'
import { colors, MIN_TARGET, spacing } from './tokens'

type Props = {
  title: string
  /** Sin `onDone` no se dibuja el botón: hay hojas que se cierran solo arrastrándolas. */
  onDone?: () => void
  onCancel?: () => void
  doneLabel?: string
  cancelLabel?: string
  /** Acción extra a la izquierda de "Listo" (compartir, más opciones). */
  trailing?: ReactNode
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    // minHeight, nunca height: el título crece con Dynamic Type.
    minHeight: MIN_TARGET,
  },
  title: { flex: 1 },
  action: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TARGET,
    minWidth: MIN_TARGET,
    paddingHorizontal: spacing[2],
  },
})

/**
 * El chrome de las 11 hojas (§12.4): título y las acciones de cerrar.
 *
 * "Cancelar" va a la izquierda y "Listo" a la derecha, en puntas opuestas: son la acción que tira lo
 * escrito y la que lo guarda, y pegadas se confunden con el dedo.
 *
 * Los hápticos de la hoja viven acá y no en cada pantalla: `sheetOpen` al montar (que es cuando la
 * hoja se presenta) y `sheetClose` en el mismo bloque que el callback. Cerrar arrastrando queda
 * mudo a propósito — el gesto ya se siente.
 */
export default function SheetHeader({
  title,
  onDone,
  onCancel,
  doneLabel,
  cancelLabel,
  trailing,
}: Props) {
  useEffect(() => {
    haptic('sheetOpen')
  }, [])

  const close = (run: () => void) => () => {
    haptic('sheetClose')
    run()
  }

  return (
    <View style={styles.header}>
      {onCancel ? (
        <PressableScale
          accessibilityLabel={cancelLabel ?? t('common.cancel')}
          onPress={close(onCancel)}
          style={styles.action}
        >
          <Text color="tint" numberOfLines={1}>
            {cancelLabel ?? t('common.cancel')}
          </Text>
        </PressableScale>
      ) : null}

      {/* Una hoja se abre pocas veces: el título se gana el peso, y con él la hoja deja de parecer
          un diálogo del sistema. */}
      <Text
        accessibilityRole="header"
        numberOfLines={2}
        role="titleEmphasized"
        style={styles.title}
      >
        {title}
      </Text>

      {trailing}

      {onDone ? (
        <PressableScale
          accessibilityLabel={doneLabel ?? t('common.done')}
          onPress={close(onDone)}
          style={styles.action}
        >
          <Text color="tint" numberOfLines={1} role="headline">
            {doneLabel ?? t('common.done')}
          </Text>
        </PressableScale>
      ) : null}
    </View>
  )
}

/**
 * Los estilos que comparten las hojas. Sin `flex: 1`: una hoja `fitToContents` mide su contenido y
 * un hijo elástico mediría cero (hoja de 0 pt). El hueco de abajo lo sigue poniendo cada pantalla
 * con `useSheetBottomInset()`, que es lo que la levanta del teclado en Android.
 */
export const sheetStyles = StyleSheet.create({
  sheet: { backgroundColor: colors.background, padding: spacing[4], gap: spacing[4] },
  /** El cuerpo debajo del header: más junto que el `gap` de la hoja, que separa bloques. */
  content: { gap: spacing[3] },
})

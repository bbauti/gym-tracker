import type { Ref } from 'react'
import { useState } from 'react'
import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native'
import Text from './Text'
import { colors, MIN_TARGET, radius, spacing } from './tokens'

type Props = TextInputProps & {
  /** Etiqueta encima del campo. Con `label` o `error` el componente pasa a ser una columna. */
  label?: string
  /** Mensaje debajo del campo; también pinta el borde. */
  error?: string
  ref?: Ref<TextInput>
}

/** Alto de un campo de varias líneas: ~4 líneas de 17/22 antes de scrollear. */
const MULTILINE_MIN = 120
const MAX_SCALE = 1.6

const styles = StyleSheet.create({
  field: {
    minHeight: MIN_TARGET,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.fill,
    // El borde está SIEMPRE puesto y solo cambia de color: agregarlo al enfocar corre el texto un
    // pelo y se lee como un salto.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    fontSize: 17,
    lineHeight: 22,
    color: colors.label,
  },
  // `textAlignVertical` es de Android: sin esto el cursor arranca centrado en la caja.
  multiline: { minHeight: MULTILINE_MIN, textAlignVertical: 'top' },
  focused: { borderColor: colors.tint },
  invalid: { borderColor: colors.destructive },
  column: { gap: spacing[1] },
})

/**
 * El campo de texto de la app (§12.4). El foco se marca con un hairline en el tint y sin animación:
 * el teclado ya está subiendo encima, y un borde que hace fade compite con eso.
 *
 * `label` y `error` van escondidos del lector y se dicen desde el propio campo: dejarlos visibles
 * como elementos aparte hace que VoiceOver lea la etiqueta dos veces (mismo criterio que
 * `calculators.tsx`).
 */
export default function Input({
  label,
  error,
  multiline,
  style,
  onBlur,
  onFocus,
  ref,
  ...rest
}: Props) {
  const [focused, setFocused] = useState(false)

  const field = (
    <TextInput
      accessibilityLabel={[label, error].filter(Boolean).join(', ') || undefined}
      maxFontSizeMultiplier={MAX_SCALE}
      placeholderTextColor={colors.tertiaryLabel}
      {...rest}
      multiline={multiline}
      onBlur={(e) => {
        setFocused(false)
        onBlur?.(e)
      }}
      onFocus={(e) => {
        setFocused(true)
        onFocus?.(e)
      }}
      ref={ref}
      style={[
        styles.field,
        multiline && styles.multiline,
        focused && styles.focused,
        // Manda sobre el foco: el campo enfocado que además está mal sigue en rojo.
        error ? styles.invalid : null,
        style,
      ]}
    />
  )

  // Sin etiqueta ni error no hay envoltorio: el campo va suelto adentro de una fila y un View de más
  // le rompe el `flex` al que lo usa.
  if (!label && !error) return field

  return (
    <View style={styles.column}>
      {label ? (
        <Text
          accessibilityElementsHidden
          color="secondary"
          importantForAccessibility="no-hide-descendants"
          role="label"
        >
          {label}
        </Text>
      ) : null}
      {field}
      {error ? (
        <Text
          accessibilityElementsHidden
          color="destructive"
          importantForAccessibility="no-hide-descendants"
          role="footnote"
        >
          {error}
        </Text>
      ) : null}
    </View>
  )
}

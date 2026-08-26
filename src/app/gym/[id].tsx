import { Stack, useLocalSearchParams } from 'expo-router'
import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import { useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { type Bar, getGym, updateGym } from '@/db/queries/gyms'
import { getSettings } from '@/db/queries/settings'
import { useQuery } from '@/db/useQuery'
import { locale, t } from '@/i18n'
import { DEFAULT_BAR_G } from '@/lib/plates'
import { formatWeight, gToUnit, parseWeight, type Unit, unitToG } from '@/lib/units'
import Chip from '@/ui/Chip'
import { haptic } from '@/ui/haptics'
import PressableScale from '@/ui/PressableScale'
import Stepper from '@/ui/Stepper'
import Text from '@/ui/Text'
import { toast } from '@/ui/Toast'
import { colors, MIN_TARGET, radius, spacing } from '@/ui/tokens'

// Es un formulario: la fila se lee una sola vez y desde ahí manda el draft. Suscrito, un refresh a
// mitad de una palabra pisaría lo que se está escribiendo.
const NO_TABLES: string[] = []

/** Los discos que hay en cualquier gimnasio, en la unidad de la app; el resto entra por "Otro…". */
const STANDARD: Record<Unit, number[]> = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25, 0.5],
  lb: [45, 35, 25, 10, 5, 2.5],
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.groupedBackground, flex: 1 },
  content: { gap: spacing[5], padding: spacing[4], paddingBottom: spacing[6] },
  sectionTitle: {
    letterSpacing: 0.4,
    paddingBottom: spacing[2],
    paddingHorizontal: spacing[2],
    textTransform: 'uppercase',
  },
  // El fondo del grupo pinta los separadores: un gap de hairline entre filas opacas.
  group: {
    backgroundColor: colors.separator,
    borderRadius: radius.md,
    gap: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  cell: { backgroundColor: colors.secondaryGroupedBackground, padding: spacing[4] },
  name: {
    backgroundColor: colors.secondaryGroupedBackground,
    color: colors.label,
    fontSize: 17,
    lineHeight: 22,
    minHeight: MIN_TARGET,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  barHead: { alignItems: 'center', flexDirection: 'row', gap: spacing[2] },
  barName: {
    borderRadius: radius.sm,
    color: colors.label,
    flex: 1,
    fontSize: 17,
    lineHeight: 22,
    minHeight: MIN_TARGET,
    paddingHorizontal: spacing[2],
  },
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TARGET,
    width: MIN_TARGET,
  },
  action: {
    backgroundColor: colors.secondaryGroupedBackground,
    justifyContent: 'center',
    minHeight: MIN_TARGET,
    paddingHorizontal: spacing[4],
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  otherRow: { alignItems: 'center', flexDirection: 'row', gap: spacing[3] },
  otherLabel: { flex: 1 },
  otherInput: {
    color: colors.label,
    fontSize: 17,
    lineHeight: 22,
    minHeight: MIN_TARGET,
    minWidth: 96,
    textAlign: 'right',
  },
})

function SectionTitle({ title }: { title: string }) {
  return (
    <Text accessibilityRole="header" color="secondary" role="footnote" style={styles.sectionTitle}>
      {title}
    </Text>
  )
}

export default function GymScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const gymId = Number(id)
  const gym = useQuery(() => getGym(gymId), NO_TABLES, [gymId])
  const unit = useQuery(() => getSettings().unit, NO_TABLES)

  const [name, setName] = useState(gym?.name ?? '')
  const [bars, setBars] = useState<Bar[]>(gym?.barsG ?? [])
  const [plates, setPlates] = useState<number[]>(gym?.platesG ?? [])
  const [other, setOther] = useState('')

  if (!gym) return null

  function commitName() {
    const trimmed = name.trim()
    // Un nombre vacío no borra el que había: el campo vuelve al guardado.
    if (trimmed) updateGym(gymId, { name: trimmed })
    else setName(getGym(gymId)?.name ?? '')
  }

  function commitBars(next: Bar[]) {
    setBars(next)
    updateGym(gymId, { barsG: next })
  }

  function commitPlates(next: number[]) {
    setPlates(next)
    updateGym(gymId, { platesG: next })
  }

  const editBar = (index: number, patch: Partial<Bar>) =>
    bars.map((b, i) => (i === index ? { ...b, ...patch } : b))

  // Sin diálogo (§7.5), pero con deshacer: "Agregar barra" devuelve una barra por defecto al final
  // de la lista, no el nombre ni el peso de esta. El restore se arma con el array de antes de sacar.
  function removeBar(index: number) {
    const before = bars
    haptic('delete')
    commitBars(bars.filter((_, i) => i !== index))
    toast.show({
      actionLabel: t('common.undo'),
      onAction: () => {
        haptic('undo')
        commitBars(before)
      },
      text: t('gyms.barDeleted'),
    })
  }

  function addOtherPlate() {
    const g = parseWeight(other, unit)
    setOther('')
    if (g === null || g <= 0 || plates.includes(g)) return
    commitPlates([...plates, g].sort((a, b) => b - a))
  }

  const step = unit === 'kg' ? 2.5 : 5
  // Un disco propio queda como chip encendido: es la única forma de volver a sacarlo.
  const options = [...new Set([...STANDARD[unit].map((v) => unitToG(v, unit)), ...plates])].sort(
    (a, b) => b - a,
  )

  return (
    <>
      {/* El título sigue al draft: con el nombre viejo arriba y el nuevo en el campo parece un bug. */}
      <Stack.Screen options={{ title: name.trim() || gym.name }} />
      <KeyboardAwareScrollView
        bottomOffset={spacing[5]}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        style={styles.screen}
      >
        <View style={styles.group}>
          <TextInput
            accessibilityLabel={t('gyms.name')}
            autoCapitalize="sentences"
            autoCorrect={false}
            maxFontSizeMultiplier={1.6}
            onChangeText={setName}
            onEndEditing={commitName}
            placeholder={t('gyms.name')}
            placeholderTextColor={colors.tertiaryLabel}
            returnKeyType="done"
            style={styles.name}
            value={name}
          />
        </View>

        <View>
          <SectionTitle title={t('gyms.bars')} />
          <View style={styles.group}>
            {bars.map((bar, index) => (
              <View
                // La posición ES la identidad: las filas no se reordenan y el estado de cada una
                // vive en el array, no en el componente.
                // biome-ignore lint/suspicious/noArrayIndexKey: ver arriba
                key={index}
                style={styles.cell}
              >
                <View style={styles.barHead}>
                  <TextInput
                    accessibilityLabel={t('gyms.barName')}
                    maxFontSizeMultiplier={1.6}
                    onChangeText={(value) => setBars(editBar(index, { name: value }))}
                    onEndEditing={() =>
                      commitBars(editBar(index, { name: bar.name.trim() || t('gyms.barDefault') }))
                    }
                    placeholder={t('gyms.barName')}
                    placeholderTextColor={colors.tertiaryLabel}
                    returnKeyType="done"
                    style={styles.barName}
                    value={bar.name}
                  />
                  <PressableScale
                    accessibilityLabel={`${t('common.delete')}, ${bar.name}`}
                    onPress={() => removeBar(index)}
                    style={styles.iconButton}
                  >
                    <SymbolView
                      fallback={
                        <Text color="destructive" role="body">
                          ✕
                        </Text>
                      }
                      name={{
                        android: 'remove_circle' as AndroidSymbol,
                        ios: 'minus.circle.fill' as SFSymbol,
                      }}
                      size={22}
                      tintColor={colors.destructive}
                    />
                  </PressableScale>
                </View>
                <Stepper
                  format={(v) => formatWeight(unitToG(v, unit), unit, locale)}
                  label={t('gyms.barWeight')}
                  max={unit === 'kg' ? 50 : 110}
                  min={step}
                  onChange={(v) => commitBars(editBar(index, { g: unitToG(v, unit) }))}
                  step={step}
                  // En lb una barra guardada en kg cae en 44,09: los gramos son la verdad y la
                  // unidad es presentación (mismo techo que la hoja de discos).
                  value={Math.round(gToUnit(bar.g, unit) * 100) / 100}
                />
              </View>
            ))}
            <PressableScale
              accessibilityLabel={t('gyms.addBar')}
              onPress={() =>
                commitBars([...bars, { g: DEFAULT_BAR_G, name: t('gyms.barDefault') }])
              }
              scale={0.98}
              style={styles.action}
            >
              <Text color="tint" role="callout">
                {t('gyms.addBar')}
              </Text>
            </PressableScale>
          </View>
        </View>

        <View>
          <SectionTitle title={t('gyms.plates')} />
          <View style={styles.group}>
            <View style={[styles.cell, styles.chips]}>
              {options.map((g) => (
                <Chip
                  key={g}
                  label={formatWeight(g, unit, locale)}
                  onPress={() =>
                    commitPlates(
                      plates.includes(g)
                        ? plates.filter((p) => p !== g)
                        : [...plates, g].sort((a, b) => b - a),
                    )
                  }
                  selected={plates.includes(g)}
                />
              ))}
            </View>
            <View style={[styles.cell, styles.otherRow]}>
              {/* El campo ya se anuncia con esta etiqueta: dejarla visible al lector la lee dos veces. */}
              <Text
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                numberOfLines={1}
                style={styles.otherLabel}
              >
                {t('gyms.otherPlate')}
              </Text>
              {/* Se agrega al salir del campo: un teclado decimal no tiene tecla de retorno en iOS. */}
              <TextInput
                accessibilityLabel={t('gyms.otherPlate')}
                keyboardType="decimal-pad"
                maxFontSizeMultiplier={1.6}
                onChangeText={setOther}
                onEndEditing={addOtherPlate}
                placeholder="0"
                placeholderTextColor={colors.tertiaryLabel}
                style={styles.otherInput}
                value={other}
              />
            </View>
          </View>
        </View>
      </KeyboardAwareScrollView>
    </>
  )
}

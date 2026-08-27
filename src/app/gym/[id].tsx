import { Stack, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { type Bar, getGym, updateGym } from '@/db/queries/gyms'
import { getSettings } from '@/db/queries/settings'
import { useQuery } from '@/db/useQuery'
import { locale, t } from '@/i18n'
import { DEFAULT_BAR_G } from '@/lib/plates'
import { formatWeight, gToUnit, parseWeight, type Unit, unitToG } from '@/lib/units'
import Button from '@/ui/Button'
import Card from '@/ui/Card'
import Chip from '@/ui/Chip'
import { haptic } from '@/ui/haptics'
import IconButton from '@/ui/IconButton'
import Input from '@/ui/Input'
import SectionHeader from '@/ui/SectionHeader'
import Stepper from '@/ui/Stepper'
import Text from '@/ui/Text'
import { toast } from '@/ui/Toast'
import { colors, spacing } from '@/ui/tokens'

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
  // El encabezado se alinea con el texto de la card, no con su borde.
  header: { paddingBottom: spacing[2], paddingHorizontal: spacing[2] },
  group: { gap: spacing[3] },
  // Cada barra es un bloque adentro de la card (§12.3): el tono la separa de la de al lado sin
  // pintar separadores a mano.
  bar: { gap: spacing[3] },
  barHead: { alignItems: 'center', flexDirection: 'row', gap: spacing[2] },
  grow: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  otherRow: { alignItems: 'center', flexDirection: 'row', gap: spacing[3] },
  otherLabel: { flex: 1 },
  otherInput: { fontVariant: ['tabular-nums'], minWidth: 110, textAlign: 'right' },
})

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
        <View>
          <SectionHeader style={styles.header} title={t('gyms.name')} />
          <Card>
            <Input
              accessibilityLabel={t('gyms.name')}
              autoCapitalize="sentences"
              autoCorrect={false}
              onChangeText={setName}
              onEndEditing={commitName}
              placeholder={t('gyms.name')}
              returnKeyType="done"
              value={name}
            />
          </Card>
        </View>

        <View>
          <SectionHeader style={styles.header} title={t('gyms.bars')} />
          <Card style={styles.group}>
            {bars.map((bar, index) => (
              <Card
                // La posición ES la identidad: las filas no se reordenan y el estado de cada una
                // vive en el array, no en el componente.
                // biome-ignore lint/suspicious/noArrayIndexKey: ver arriba
                key={index}
                style={styles.bar}
                variant="inset"
              >
                <View style={styles.barHead}>
                  <Input
                    accessibilityLabel={t('gyms.barName')}
                    onChangeText={(value) => setBars(editBar(index, { name: value }))}
                    onEndEditing={() =>
                      commitBars(editBar(index, { name: bar.name.trim() || t('gyms.barDefault') }))
                    }
                    placeholder={t('gyms.barName')}
                    returnKeyType="done"
                    style={styles.grow}
                    value={bar.name}
                  />
                  <IconButton
                    fallback="✕"
                    label={`${t('common.delete')}, ${bar.name}`}
                    md="remove_circle"
                    onPress={() => removeBar(index)}
                    sf="minus.circle"
                    tint="destructive"
                  />
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
              </Card>
            ))}
            <Button
              md="add"
              onPress={() =>
                commitBars([...bars, { g: DEFAULT_BAR_G, name: t('gyms.barDefault') }])
              }
              sf="plus"
              title={t('gyms.addBar')}
              variant="plain"
            />
          </Card>
        </View>

        <View>
          <SectionHeader style={styles.header} title={t('gyms.plates')} />
          <Card style={styles.group}>
            <View style={styles.chips}>
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
            <View style={styles.otherRow}>
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
              <Input
                accessibilityLabel={t('gyms.otherPlate')}
                keyboardType="decimal-pad"
                onChangeText={setOther}
                onEndEditing={addOtherPlate}
                placeholder="0"
                style={styles.otherInput}
                value={other}
              />
            </View>
          </Card>
        </View>
      </KeyboardAwareScrollView>
    </>
  )
}

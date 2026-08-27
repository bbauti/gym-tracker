import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { activeGym } from '@/db/queries/gyms'
import { getSettings } from '@/db/queries/settings'
import { useQuery } from '@/db/useQuery'
import { locale, t } from '@/i18n'
import { DEFAULT_BAR_G, DEFAULT_PLATES_G, nearestLoadable, platesFor } from '@/lib/plates'
import { formatWeight } from '@/lib/units'
import BigNumber from '@/ui/BigNumber'
import Chip from '@/ui/Chip'
import { Enter } from '@/ui/motion'
import SheetHeader, { sheetStyles } from '@/ui/SheetHeader'
import Text from '@/ui/Text'
import { colors, radius, spacing } from '@/ui/tokens'

// ponytail: las barras y los discos salen del gimnasio activo (J02) y, sin gimnasio, de los defaults
// de lib/plates. Techo: en lb las etiquetas salen convertidas (25 kg → 55,12 lb) porque los discos
// que se cargaron siguen siendo métricos. Upgrade: guardar el disco en su unidad, no solo en gramos.
const GYM_TABLES = ['settings', 'gym']
const DEFAULT_BARS = [{ g: DEFAULT_BAR_G, name: t('gyms.barDefault') }]
const PILL_MIN = 44
const PILL_RANGE = 32

const styles = StyleSheet.create({
  plates: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: PILL_MIN,
  },
  pill: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 52,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.fill,
  },
  // Decorativo: el sleeve de la barra debajo de los discos. Sin texto, VoiceOver no lo ve.
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.separator },
  centered: { textAlign: 'center' },
  bars: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], justifyContent: 'center' },
})

export default function PlatesScreen() {
  const { weightG } = useLocalSearchParams<{ weightG: string }>()
  const insets = useSafeAreaInsets()
  const { gym, unit } = useQuery(() => ({ gym: activeGym(), unit: getSettings().unit }), GYM_TABLES)
  // No persiste: es de esta hoja, y la hoja se abre para un peso concreto.
  const [barIndex, setBarIndex] = useState(0)

  const bars = gym?.barsG?.length ? gym.barsG : DEFAULT_BARS
  const platesG = gym?.platesG?.length ? gym.platesG : DEFAULT_PLATES_G
  // El gimnasio pudo cambiar de barras con la hoja abierta.
  const activeBar = Math.min(barIndex, bars.length - 1)
  const bar = bars[activeBar]

  const asked = Number(weightG)
  const targetG = Number.isFinite(asked) && asked > 0 ? Math.round(asked) : bar.g
  // nearestLoadable siempre cae en un peso armable, así que platesFor de ese peso es exacto.
  const loadableG = nearestLoadable(targetG, bar.g, platesG)
  const perSide = platesFor(loadableG, bar.g, platesG)?.perSide ?? []
  const heaviest = Math.max(...platesG)
  const weight = (g: number) => formatWeight(g, unit, locale)
  // Con una sola barra el nombre no aporta nada; con varias es lo que dice cuál está puesta.
  const barLabel =
    bars.length > 1 ? `${bar.name} · ${weight(bar.g)}` : t('plates.bar', { w: weight(bar.g) })

  return (
    <View style={[sheetStyles.sheet, { paddingBottom: insets.bottom + spacing[4] }]}>
      <SheetHeader onDone={() => router.back()} title={t('plates.title')} />

      <View style={sheetStyles.content}>
        {/* El peso partido en número y unidad: el `kg` no se gana los 56 pt del numeral. Sale igual
            que `formatWeight` con unidad, que es lo que se veía antes. */}
        <BigNumber
          align="center"
          unit={unit}
          value={formatWeight(targetG, unit, locale, { withUnit: false })}
        />
        <Text color="secondary" role="footnote" style={styles.centered}>
          {t('plates.perSide')}
        </Text>

        {/* Fade al montar y nada más: los discos solo cambian si se toca otra barra. */}
        <Animated.View
          accessible
          accessibilityLabel={`${t('plates.perSide')}: ${
            perSide.length > 0 ? perSide.map(weight).join(', ') : barLabel
          }`}
          entering={Enter.fade}
          style={styles.plates}
        >
          {perSide.length > 0 ? (
            perSide.map((g, i) => (
              <View
                // Los discos repetidos no tienen id: la posición es la identidad y la lista no se reordena.
                // biome-ignore lint/suspicious/noArrayIndexKey: ver arriba
                key={`${g}:${i}`}
                style={[styles.pill, { minHeight: PILL_MIN + PILL_RANGE * (g / heaviest) }]}
              >
                <Text role="callout" tabular>
                  {formatWeight(g, unit, locale, { withUnit: false })}
                </Text>
              </View>
            ))
          ) : (
            <Text color="tertiary" role="body">
              —
            </Text>
          )}
        </Animated.View>

        <View style={styles.bar} />
        <Text color="secondary" role="footnote" style={styles.centered}>
          {barLabel}
        </Text>

        {bars.length > 1 ? (
          <View style={styles.bars}>
            {bars.map((b, i) => (
              <Chip
                accessibilityLabel={`${b.name}, ${weight(b.g)}`}
                // Dos barras pueden llamarse igual y pesar lo mismo: la posición es la identidad.
                // biome-ignore lint/suspicious/noArrayIndexKey: ver arriba
                key={i}
                label={b.name}
                onPress={() => setBarIndex(i)}
                selected={i === activeBar}
              />
            ))}
          </View>
        ) : null}

        {loadableG !== targetG ? (
          <Text color="tertiary" role="footnote" style={styles.centered}>
            {t('plates.notLoadable', { w: weight(loadableG) })}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

import { router, useLocalSearchParams } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getSettings } from '@/db/queries/settings'
import { useQuery } from '@/db/useQuery'
import { locale, t } from '@/i18n'
import { DEFAULT_BAR_G, DEFAULT_PLATES_G, nearestLoadable, platesFor } from '@/lib/plates'
import { formatWeight } from '@/lib/units'
import PressableScale from '@/ui/PressableScale'
import Text from '@/ui/Text'
import { colors, radius, spacing } from '@/ui/tokens'

// ponytail: barra de 20 kg y tabla de discos fijas (los defaults de lib/plates). Techo: en lb las
// etiquetas salen convertidas (25 kg → 55,12 lb) porque los discos siguen siendo métricos.
// Upgrade: `gym.bars_g` / `gym.plates_g` — Fase 7 (J02).
const HEAVIEST = Math.max(...DEFAULT_PLATES_G)
const PILL_MIN = 44
const PILL_RANGE = 32

const styles = StyleSheet.create({
  // Sin flex: la sheet es fitToContents y un flex:1 la deja de alto cero.
  sheet: { padding: spacing[4], gap: spacing[3], backgroundColor: colors.background },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  done: { paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
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
    borderRadius: radius.sm,
    backgroundColor: colors.fill,
  },
  // Decorativo: el sleeve de la barra debajo de los discos. Sin texto, VoiceOver no lo ve.
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.separator },
  centered: { textAlign: 'center' },
})

export default function PlatesScreen() {
  const { weightG } = useLocalSearchParams<{ weightG: string }>()
  const insets = useSafeAreaInsets()
  const unit = useQuery(() => getSettings().unit, ['settings'])

  const asked = Number(weightG)
  const targetG = Number.isFinite(asked) && asked > 0 ? Math.round(asked) : DEFAULT_BAR_G
  // nearestLoadable siempre cae en un peso armable, así que platesFor de ese peso es exacto.
  const loadableG = nearestLoadable(targetG, DEFAULT_BAR_G, DEFAULT_PLATES_G)
  const perSide = platesFor(loadableG, DEFAULT_BAR_G, DEFAULT_PLATES_G)?.perSide ?? []
  const weight = (g: number) => formatWeight(g, unit, locale)

  return (
    <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing[4] }]}>
      <View style={styles.head}>
        <Text accessibilityRole="header" role="headline">
          {t('plates.title')}
        </Text>
        <PressableScale
          accessibilityLabel={t('common.done')}
          onPress={() => router.back()}
          style={styles.done}
        >
          <Text color="tint" role="headline">
            {t('common.done')}
          </Text>
        </PressableScale>
      </View>

      <Text role="largeTitle" style={styles.centered} tabular>
        {weight(targetG)}
      </Text>
      <Text color="secondary" role="footnote" style={styles.centered}>
        {t('plates.perSide')}
      </Text>

      {/* FadeIn al montar y nada más: los discos no cambian mientras la sheet está abierta. */}
      <Animated.View
        accessible
        accessibilityLabel={`${t('plates.perSide')}: ${
          perSide.length > 0
            ? perSide.map(weight).join(', ')
            : t('plates.bar', { w: weight(DEFAULT_BAR_G) })
        }`}
        entering={FadeIn.duration(200)}
        style={styles.plates}
      >
        {perSide.length > 0 ? (
          perSide.map((g, i) => (
            <View
              // Los discos repetidos no tienen id: la posición es la identidad y la lista no se reordena.
              // biome-ignore lint/suspicious/noArrayIndexKey: ver arriba
              key={`${g}:${i}`}
              style={[styles.pill, { minHeight: PILL_MIN + PILL_RANGE * (g / HEAVIEST) }]}
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
        {t('plates.bar', { w: weight(DEFAULT_BAR_G) })}
      </Text>

      {loadableG !== targetG ? (
        <Text color="tertiary" role="footnote" style={styles.centered}>
          {t('plates.notLoadable', { w: weight(loadableG) })}
        </Text>
      ) : null}
    </View>
  )
}

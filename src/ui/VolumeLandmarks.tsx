import { router } from 'expo-router'
import { type ColorValue, StyleSheet, View } from 'react-native'
import type { Muscle } from '@/db/schema'
import { locale, plural, t } from '@/i18n'
import { type Landmark, landmarkZone, type Zone } from '@/lib/progression'
import Card from './Card'
import PressableScale from './PressableScale'
import ProgressBar from './ProgressBar'
import Text from './Text'
import { colors, MIN_TARGET, Press, radius, spacing } from './tokens'

export type VolumeRow = { muscle: Muscle; sets: number; landmark: Landmark }

/** Aire después del MRV: pasarse tiene que verse como pasarse, no como una barra llena más. */
const TRACK_HEADROOM = 1.15
const TICKS = ['mev', 'mav', 'mrv'] as const

/** Medias series (un secundario cuenta 0,5): "7,5" es el dato, "8" sería mentira. */
const setsFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })

const ZONE_COLOR: Record<Zone, ColorValue> = {
  below: colors.tertiaryLabel,
  mev: colors.tint,
  mav: colors.success,
  mrv: colors.warning,
  over: colors.destructive,
}

const styles = StyleSheet.create({
  card: { gap: spacing[2] },
  // `borderRadius` para el wash del press: la fila no tiene fondo propio, el radio es solo suyo.
  row: {
    borderRadius: radius.sm,
    gap: spacing[1],
    justifyContent: 'center',
    minHeight: MIN_TARGET,
    paddingVertical: spacing[1],
  },
  head: { alignItems: 'center', flexDirection: 'row', gap: spacing[2] },
  grow: { flex: 1 },
})

function Row({ muscle, sets, landmark }: VolumeRow) {
  const name = t(`muscle.${muscle}`)
  const zone = landmarkZone(sets, landmark)
  const setsText = setsFormat.format(sets)
  // El 1 es red de seguridad: sin MRV la barra no tendría escala (esos músculos no llegan acá).
  const max = Math.max(landmark.mrv * TRACK_HEADROOM, sets, 1)
  // Media serie cae en "otras", que es lo correcto en los dos idiomas ("0,5 series" / "0.5 sets").
  const vars = { muscle: name, sets: setsText, zone: t(`landmarks.zone.${zone}`) }
  const label = plural(sets, t('landmarks.a11y.one', vars), t('landmarks.a11y.other', vars))

  return (
    <PressableScale
      accessibilityHint={t('landmarks.edit')}
      accessibilityLabel={label}
      highlight
      onPress={() => router.push(`/landmarks?muscle=${muscle}`)}
      // Fila de ancho completo: el 0.96 por defecto es para controles chicos y acá se notaría.
      scale={Press.row}
      style={styles.row}
    >
      <View style={styles.head}>
        <Text numberOfLines={1} role="callout" style={styles.grow}>
          {name}
        </Text>
        <Text color="secondary" role="footnote" tabular>
          {setsText}
        </Text>
      </View>
      {/* Decorativa: la fila ya se anuncia con las series y la banda en palabras, y un
          `progressbar` adentro sería una segunda parada que dice lo mismo en porcentaje. */}
      <ProgressBar
        accessibilityElementsHidden
        color={ZONE_COLOR[zone]}
        height={8}
        importantForAccessibility="no-hide-descendants"
        progress={sets / max}
        roundedEnd
        ticks={TICKS.map((k) => landmark[k] / max)}
      />
    </PressableScale>
  )
}

/**
 * E07. Series duras de la semana contra MEV/MAV/MRV, un músculo por fila.
 *
 * Solo informa: la banda no cambia ninguna rutina ni ningún peso (§2.2). Lo único editable es el
 * landmark, y eso pasa en la hoja de al lado.
 */
export default function VolumeLandmarks({ rows }: { rows: VolumeRow[] }) {
  // Por series, que es lo que dibuja la barra; el nombre solo desempata para que el orden no baile.
  const sorted = [...rows].sort(
    (a, b) =>
      b.sets - a.sets || t(`muscle.${a.muscle}`).localeCompare(t(`muscle.${b.muscle}`), locale),
  )
  return (
    <Card style={styles.card}>
      {sorted.map((r) => (
        <Row key={r.muscle} landmark={r.landmark} muscle={r.muscle} sets={r.sets} />
      ))}
    </Card>
  )
}

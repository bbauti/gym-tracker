import { router } from 'expo-router'
import { type ColorValue, StyleSheet, View } from 'react-native'
import type { Muscle } from '@/db/schema'
import { locale, plural, t } from '@/i18n'
import { type Landmark, landmarkZone, type Zone } from '@/lib/progression'
import Card from './Card'
import PressableScale from './PressableScale'
import Text from './Text'
import { colors, MIN_TARGET, spacing } from './tokens'

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
  row: {
    gap: spacing[1],
    justifyContent: 'center',
    minHeight: MIN_TARGET,
    paddingVertical: spacing[1],
  },
  head: { alignItems: 'center', flexDirection: 'row', gap: spacing[2] },
  grow: { flex: 1 },
  track: { backgroundColor: colors.fill, borderRadius: 4, height: 8, overflow: 'hidden' },
  // Punta redondeada del lado del dato, cuadrada contra la línea de base (igual que Progreso).
  fill: { borderBottomRightRadius: 4, borderTopRightRadius: 4, height: 8 },
  // Muescas del color de la card: se leen igual sobre el relleno y sobre la pista vacía.
  tick: {
    backgroundColor: colors.secondaryGroupedBackground,
    bottom: 0,
    marginLeft: -1,
    position: 'absolute',
    top: 0,
    width: 2,
  },
})

function Row({ muscle, sets, landmark }: VolumeRow) {
  const name = t(`muscle.${muscle}`)
  const zone = landmarkZone(sets, landmark)
  const setsText = setsFormat.format(sets)
  // El 1 es red de seguridad: sin MRV la barra no tendría escala (esos músculos no llegan acá).
  const max = Math.max(landmark.mrv * TRACK_HEADROOM, sets, 1)
  const pct = (v: number) => Math.min(100, (v / max) * 100)
  // Media serie cae en "otras", que es lo correcto en los dos idiomas ("0,5 series" / "0.5 sets").
  const vars = { muscle: name, sets: setsText, zone: t(`landmarks.zone.${zone}`) }
  const label = plural(sets, t('landmarks.a11y.one', vars), t('landmarks.a11y.other', vars))

  return (
    <PressableScale
      accessibilityHint={t('landmarks.edit')}
      accessibilityLabel={label}
      onPress={() => router.push(`/landmarks?muscle=${muscle}`)}
      // Fila de ancho completo: el 0.96 por defecto es para controles chicos y acá se notaría.
      scale={0.98}
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
      {/* Sin animación: el volumen de la semana cambia una vez por sesión, no por frame (§7.5). */}
      <View style={styles.track}>
        <View
          style={[styles.fill, { backgroundColor: ZONE_COLOR[zone], width: `${pct(sets)}%` }]}
        />
        {TICKS.map((k) => (
          <View key={k} style={[styles.tick, { left: `${pct(landmark[k])}%` }]} />
        ))}
      </View>
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

import { Stack, useLocalSearchParams } from 'expo-router'
import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import { type ReactNode, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { db } from '@/db/client'
import { exerciseHistory, exerciseName, getExercise, updateExercise } from '@/db/queries/exercises'
import { isStalled, suggestFor } from '@/db/queries/progression'
import { currentBests, listPrs } from '@/db/queries/prs'
import type { SetRow } from '@/db/queries/session'
import { getSettings } from '@/db/queries/settings'
import type { Metric } from '@/db/schema'
import { useQuery } from '@/db/useQuery'
import { locale, t } from '@/i18n'
import type { PrKind } from '@/lib/prs'
import {
  defaultIncrementG,
  formatDistance,
  formatDuration,
  formatWeight,
  type Unit,
  unitToG,
} from '@/lib/units'
import Badge from '@/ui/Badge'
import Bento from '@/ui/Bento'
import EmptyState from '@/ui/EmptyState'
import { haptic } from '@/ui/haptics'
import IconButton from '@/ui/IconButton'
import Input from '@/ui/Input'
import ListRow from '@/ui/ListRow'
import Menu from '@/ui/Menu'
import { prKindsLabel } from '@/ui/PrBadge'
import SectionHeader from '@/ui/SectionHeader'
import Text from '@/ui/Text'
import Tile from '@/ui/Tile'
import { colors, MIN_TARGET, radius, spacing } from '@/ui/tokens'

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  content: { padding: spacing[4], gap: spacing[5] },
  meta: { paddingHorizontal: spacing[2] },
  // El encabezado se alinea con el texto de las filas, no con el borde de la card.
  sectionHeader: { paddingHorizontal: spacing[2] },
  section: { gap: spacing[2] },
  // Un bloque del bento respira más que un encabezado sobre su lista.
  block: { gap: spacing[3] },
  // El fondo del grupo pinta los separadores: un gap de hairline entre filas opacas.
  group: {
    borderRadius: radius.md,
    overflow: 'hidden',
    gap: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },
  // `ui/ListRow` trae su propio fondo y su propio separador: acá solo se recorta el bloque.
  list: { borderRadius: radius.md, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TARGET,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    backgroundColor: colors.secondaryGroupedBackground,
  },
  rowLabel: { flex: 1 },
  historyRow: {
    gap: spacing[1],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: colors.secondaryGroupedBackground,
  },
  // Suelto sobre el fondo, sin card: son dos líneas de estado, no un dato guardado.
  callout: { gap: spacing[2], paddingHorizontal: spacing[2] },
})

/** Las sesiones que mira `isStalled` (E05): el texto las nombra. */
const STALL_SESSIONS = 3

const dayFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })

const startOfDay = (ts: number) => new Date(ts).setHours(0, 0, 0, 0)

function formatDay(ts: number): string {
  const days = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86_400_000)
  if (days === 0) return t('history.today')
  if (days === 1) return t('history.yesterday')
  return dayFormat.format(new Date(ts))
}

/** Una serie en una línea, según lo que mide el ejercicio: "60 × 8", "12", "1:30", "5 km". */
function formatSet(set: SetRow, metric: Metric, unit: Unit): string {
  const distanceUnit = unit === 'kg' ? 'km' : 'mi'
  switch (metric) {
    case 'reps':
      return set.reps === null ? '—' : String(set.reps)
    case 'duration':
      return set.durationMs === null ? '—' : formatDuration(set.durationMs)
    case 'distance':
      return set.distanceMm === null ? '—' : formatDistance(set.distanceMm, distanceUnit, locale)
    case 'duration_distance':
      return (
        [
          set.durationMs === null ? null : formatDuration(set.durationMs),
          set.distanceMm === null ? null : formatDistance(set.distanceMm, distanceUnit, locale),
        ]
          .filter(Boolean)
          .join(' · ') || '—'
      )
    default: {
      const weight =
        set.weightG === null ? null : formatWeight(set.weightG, unit, locale, { withUnit: false })
      const reps = set.reps === null ? null : String(set.reps)
      if (weight !== null && reps !== null) return `${weight} × ${reps}`
      return weight ?? reps ?? '—'
    }
  }
}

/**
 * Un récord sale de peso × repeticiones (H01–H04): un ejercicio que se mide en tiempo o en metros
 * nunca va a tener uno, así que la sección no se dibuja para no prometer nada.
 */
const HAS_PRS: Record<Metric, boolean> = {
  weight_reps: true,
  weighted_bodyweight: true,
  reps: true,
  duration: false,
  distance: false,
  duration_distance: false,
}

/** El trigger del Menu no es un Pressable: el menú nativo necesita el tap para abrirse. */
function PickerRow({
  label,
  value,
  items,
  onSelect,
}: {
  label: string
  value: string
  items: { key: string; label: string }[]
  onSelect: (key: string) => void
}) {
  return (
    <Menu items={items} onSelect={onSelect}>
      <View
        accessible
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityValue={{ text: value }}
        style={styles.row}
      >
        <Text numberOfLines={1} style={styles.rowLabel}>
          {label}
        </Text>
        <Text color="secondary" tabular>
          {value}
        </Text>
        <SymbolView
          fallback={
            <Text color="tertiary" role="footnote">
              ⌄
            </Text>
          }
          name={{
            ios: 'chevron.up.chevron.down' as SFSymbol,
            android: 'unfold_more' as AndroidSymbol,
          }}
          size={12}
          tintColor={colors.tertiaryLabel}
        />
      </View>
    </Menu>
  )
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      {title ? <SectionHeader style={styles.sectionHeader} title={title} /> : null}
      <View style={styles.group}>{children}</View>
    </View>
  )
}

// ponytail: los incrementos salen de una tabla fija por unidad, no del disco más chico del gym.
// Techo: en lb las opciones son 1/2.5/5/10 lb redondeadas a gramos. Upgrade: tabla de gimnasio (J02).
const incrementsFor = (unit: Unit): number[] =>
  unit === 'kg' ? [1000, 1250, 2500, 5000] : [1, 2.5, 5, 10].map((v) => unitToG(v, 'lb'))

const RESTS_SEC = [60, 90, 120, 180]

const EMPTY = '—'

/**
 * Una suma de gramos, no una marca: en lb sin redondear el volumen de una serie salía "1.322,77 lb"
 * (mismo criterio que Progreso e Historial). 82,5 kg redondeado a 83 kg, en cambio, ya no es la marca.
 */
const BULK = { maxFractionDigits: 0 }

/** Las tres marcas de hoy, en el orden en el que se miran: cuánto levantó, cuánto vale, cuánto movió. */
const BEST_COLUMNS = [
  { bulk: false, key: 'weightG', label: 'progress.maxWeight' },
  { bulk: false, key: 'e1rmG', label: 'progress.e1rm' },
  { bulk: true, key: 'volumeG', label: 'progress.volume' },
] as const

export default function ExerciseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const exerciseId = Number(id)
  const exercise = useQuery(() => getExercise(exerciseId), ['exercise'], [exerciseId])
  const history = useQuery(
    () => exerciseHistory(exerciseId),
    ['session', 'session_exercise', 'set_entry'],
    [exerciseId],
  )
  // Los récords son un cache reconstruible (plan §3): cualquier cosa que los mueva reescribe
  // `personal_record`, así que alcanza con esa tabla. `set_entry` está porque la fila trae su serie.
  const records = useQuery(
    () => ({ bests: currentBests(exerciseId), list: listPrs(exerciseId, 10) }),
    ['personal_record', 'set_entry'],
    [exerciseId],
  )
  // La sugerencia de hoy, recalculada acá: la que se guardó en una sesión es de ese día. Informativa
  // y nada más — de esta pantalla no sale ningún peso escrito (§2.2).
  const progression = useQuery(
    () => ({ stalled: isStalled(exerciseId), suggestion: suggestFor(db, exerciseId) }),
    ['session', 'session_exercise', 'set_entry', 'settings', 'exercise'],
    [exerciseId],
  )
  const settings = useQuery(getSettings, ['settings'])
  // El único que escribe `notes` es esta pantalla, así que el estado inicial alcanza.
  const [notes, setNotes] = useState(exercise?.notes ?? '')

  if (!exercise) return <EmptyState title={t('error.title')} />

  const unit = settings.unit
  const increment = exercise.defaultIncrementG ?? defaultIncrementG(unit)
  const rest = exercise.defaultRestSec ?? settings.defaultRestSec

  // `skipTick`: el háptico de los dos lo pone `onMenu`, y el tic del menú se lo comería (gate global).
  const menuItems = [
    {
      key: 'favorite',
      label: exercise.isFavorite ? t('exercise.unfavorite') : t('exercise.favorite'),
      sf: exercise.isFavorite ? 'star.slash' : 'star',
      md: 'star',
      skipTick: true,
    },
    {
      key: 'archive',
      label: exercise.isArchived ? t('exercise.unarchive') : t('exercise.archive'),
      sf: exercise.isArchived ? 'tray.and.arrow.up' : 'archivebox',
      md: 'inventory_2',
      skipTick: true,
    },
  ]

  const onMenu = (key: string) => {
    // Prender y apagar no se sienten igual (§12.3): el que saca de favoritos o desarchiva es Soft.
    const turningOn = key === 'favorite' ? !exercise.isFavorite : !exercise.isArchived
    haptic(turningOn ? 'toggle' : 'toggleOff')
    if (key === 'favorite') updateExercise(exerciseId, { isFavorite: !exercise.isFavorite })
    else updateExercise(exerciseId, { isArchived: !exercise.isArchived })
  }

  const { reason, weightG } = progression.suggestion
  const suggestion =
    weightG !== null && reason !== 'none'
      ? `${t('progression.suggested', { weight: formatWeight(weightG, unit, locale) })} · ${t(
          `progression.reason.${reason}`,
        )}`
      : null

  const meta = [
    t(`muscle.${exercise.primaryMuscle}`),
    t(`equipment.${exercise.equipment}`),
    exercise.pattern ? t(`pattern.${exercise.pattern}`) : null,
    t(`metric.${exercise.metric}`),
    exercise.isArchived ? t('library.archived') : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <KeyboardAvoidingView automaticOffset behavior="padding" style={styles.screen}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Menu items={menuItems} onSelect={onMenu}>
              <IconButton
                asMenuTrigger
                fallback="···"
                label={t('common.more')}
                md="more_horiz"
                sf="ellipsis.circle"
                tint="tint"
              />
            </Menu>
          ),
          title: exerciseName(exercise, locale),
        }}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      >
        {/* ponytail: la ficha del catálogo (músculo, equipo, patrón, métrica) es de solo lectura,
            incluso en los ejercicios propios. Techo: para corregir un dato hay que crear otro.
            Upgrade: un sheet de edición reusando el formulario de exercise/new. */}
        <Text color="secondary" style={styles.meta}>
          {meta}
        </Text>

        <View style={styles.section}>
          <SectionHeader style={styles.sectionHeader} title={t('exercise.notes')} />
          <Input
            accessibilityLabel={t('exercise.notes')}
            multiline
            onBlur={() => {
              const next = notes.trim() || null
              // Sin el guard, cada blur escribe igual y despierta a todos los useQuery de 'exercise'.
              if (next !== exercise.notes) updateExercise(exerciseId, { notes: next })
            }}
            onChangeText={setNotes}
            placeholder={t('exercise.notesPlaceholder')}
            value={notes}
          />
        </View>

        {/* Sin título: el grupo son dos filas que ya se explican solas. */}
        <Section>
          <PickerRow
            items={incrementsFor(unit).map((g) => ({
              key: String(g),
              label: formatWeight(g, unit, locale),
            }))}
            label={t('exercise.increment')}
            onSelect={(key) => updateExercise(exerciseId, { defaultIncrementG: Number(key) })}
            value={formatWeight(increment, unit, locale)}
          />
          <PickerRow
            items={RESTS_SEC.map((sec) => ({
              key: String(sec),
              label: formatDuration(sec * 1000),
            }))}
            label={t('exercise.rest')}
            onSelect={(key) => updateExercise(exerciseId, { defaultRestSec: Number(key) })}
            value={formatDuration(rest * 1000)}
          />
        </Section>

        {/* Sin título: el estancamiento y el próximo peso se leen solos, y van pegados a los
            récords porque son la misma pregunta (cómo viene esto). */}
        {progression.stalled || suggestion ? (
          <View accessible style={styles.callout}>
            {progression.stalled ? (
              <Badge
                label={t('exercise.stalled', { n: STALL_SESSIONS })}
                size="md"
                tone="warning"
              />
            ) : null}
            {suggestion ? (
              <Text color="secondary" role="label" tabular>
                {suggestion}
              </Text>
            ) : null}
          </View>
        ) : null}

        {HAS_PRS[exercise.metric] ? (
          records.list.length === 0 ? (
            <Section title={t('pr.history')}>
              <View style={styles.historyRow}>
                <Text color="secondary">{t('pr.none')}</Text>
              </View>
            </Section>
          ) : (
            <View style={styles.block}>
              <SectionHeader style={styles.sectionHeader} title={t('pr.history')} />
              <Bento.Row>
                {BEST_COLUMNS.map(({ bulk, key, label }) => {
                  const value = records.bests[key]
                  return (
                    <Tile
                      key={key}
                      title={t(label)}
                      value={
                        value === null
                          ? EMPTY
                          : formatWeight(value, unit, locale, bulk ? BULK : undefined)
                      }
                    />
                  )
                })}
              </Bento.Row>
              <View style={styles.list}>
                {records.list.map((pr) => {
                  // `value_g` de un récord de peso corporal es 0, no null (`prRows` normaliza con
                  // `?? 0`): "Reps a 0 kg" no se lee, y el nombre del equipo dice lo mismo.
                  const weight = pr.valueG
                    ? formatWeight(pr.valueG, unit, locale, pr.kind === 'volume' ? BULK : undefined)
                    : t('equipment.bodyweight')
                  const title = prKindsLabel([pr.kind as PrKind], weight)
                  const value = String(pr.kind === 'reps_at_weight' ? (pr.reps ?? EMPTY) : weight)
                  const day = formatDay(pr.achievedAt)
                  return (
                    <ListRow
                      key={pr.id}
                      label={`${title}, ${value}, ${day}`}
                      subtitle={day}
                      title={title}
                      trailing={
                        <Text role="headline" tabular>
                          {value}
                        </Text>
                      }
                    />
                  )
                })}
              </View>
            </View>
          )
        ) : null}

        <Section title={t('exercise.history')}>
          {history.length === 0 ? (
            <View style={styles.historyRow}>
              <Text color="secondary">{t('exercise.noHistory')}</Text>
            </View>
          ) : (
            history.map(({ session, sets }) => {
              const line = sets.map((set) => formatSet(set, exercise.metric, unit)).join(', ')
              return (
                <View accessible key={session.id} style={styles.historyRow}>
                  <Text role="headline">{formatDay(session.startedAt)}</Text>
                  <Text color="secondary" tabular>
                    {line}
                  </Text>
                </View>
              )
            })
          )}
        </Section>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

import { FlashList } from '@shopify/flash-list'
import { router, Stack } from 'expo-router'
import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import {
  type Exercise,
  exerciseName,
  searchExercises,
  updateExercise,
} from '@/db/queries/exercises'
import { EQUIPMENT, type Equipment, MUSCLES, type Muscle } from '@/db/schema'
import { useQuery } from '@/db/useQuery'
import { locale, t } from '@/i18n'
import Chip from '@/ui/Chip'
import EmptyState from '@/ui/EmptyState'
import { haptic } from '@/ui/haptics'
import IconButton from '@/ui/IconButton'
import PressableScale from '@/ui/PressableScale'
import Text from '@/ui/Text'
import { colors, opacity, Press, spacing } from '@/ui/tokens'

/** Fila del catálogo: 52 pt, no 44 (§12.5). Dos líneas de texto piden más aire que un target. */
const ROW_MIN = 52

const styles = StyleSheet.create({
  list: { backgroundColor: colors.background },
  filters: { gap: spacing[2], paddingHorizontal: spacing[4], paddingVertical: spacing[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  rowMain: {
    flex: 1,
    minHeight: ROW_MIN,
    justifyContent: 'center',
    paddingVertical: spacing[2],
  },
  // 500 no es un rol: es `body` con un pelo más de peso para que el nombre gane a su propia meta
  // sin llegar a `headline`, que en 40 filas seguidas grita.
  name: { fontWeight: '500' },
  archived: { opacity: opacity.ghost },
  footer: { alignItems: 'center', padding: spacing[4] },
  empty: { paddingTop: spacing[6] },
})

// FlashList v2 ancla el scroll al contenido visible por defecto (pensado para chats): en una lista
// que se rearma entera en cada tecla eso pelea con el filtrado.
const KEEP_POSITION_OFF = { disabled: true }

const keyExtractor = (item: Exercise) => String(item.id)

const noResults = (
  <View style={styles.empty}>
    <EmptyState
      description={t('library.noResults.description')}
      md="search"
      sf="magnifyingglass"
      title={t('library.noResults.title')}
    />
  </View>
)

function HeaderAdd() {
  return (
    <IconButton
      fallback="+"
      label={t('library.new')}
      md="add"
      onPress={() => router.push('/exercise/new')}
      sf="plus"
      tint="tint"
    />
  )
}

/** Dos pressables hermanos, no anidados: el de la fila se traga los taps del hijo y VoiceOver
 *  solo ve el contenedor. La estrella es su propio botón. */
function ExerciseRow({ item }: { item: Exercise }) {
  const name = exerciseName(item, locale)
  const meta = `${t(`muscle.${item.primaryMuscle}`)} · ${t(`equipment.${item.equipment}`)}`
  const fav = item.isFavorite
  return (
    <View style={[styles.row, item.isArchived && styles.archived]}>
      <PressableScale
        accessibilityLabel={`${name}, ${meta}`}
        onPress={() => router.push({ pathname: '/exercise/[id]', params: { id: item.id } })}
        scale={Press.row}
        style={styles.rowMain}
      >
        <Text numberOfLines={1} style={styles.name}>
          {name}
        </Text>
        <Text color="secondary" numberOfLines={1} role="footnote">
          {meta}
        </Text>
      </PressableScale>
      {/* Figura Y color: la favorita es acento y relleno, el resto contorno terciario. Cuarenta
          estrellas en acento le ganarían al nombre, que es lo que se lee de reojo en la lista. */}
      <IconButton
        accessibilityState={{ selected: fav }}
        fallback={fav ? '★' : '☆'}
        label={fav ? t('exercise.unfavorite') : t('exercise.favorite')}
        md={fav ? 'star' : 'star_border'}
        onPress={() => {
          haptic(fav ? 'toggleOff' : 'toggle')
          updateExercise(item.id, { isFavorite: !fav })
        }}
        sf={fav ? 'star.fill' : 'star'}
        tint={fav ? 'tint' : 'tertiary'}
      />
    </View>
  )
}

const renderItem = ({ item }: { item: Exercise }) => <ExerciseRow item={item} />

export default function ExercisesScreen() {
  const [q, setQ] = useState('')
  const [muscle, setMuscle] = useState<Muscle>()
  const [equipment, setEquipment] = useState<Equipment>()
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [includeArchived, setIncludeArchived] = useState(false)

  const items = useQuery(
    () => searchExercises(q, locale, { muscle, equipment, favoritesOnly, includeArchived }),
    ['exercise'],
    [q, muscle, equipment, favoritesOnly, includeArchived],
  )

  // ponytail: dos filas de chips en vez de un Menu de equipo. Techo: con el teclado abierto quedan
  // ~80 pt de filtros arriba de los resultados. Upgrade: colapsar la fila de equipo a un Menu.
  const filters = (
    <View>
      <ScrollView
        contentContainerStyle={styles.filters}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        <Chip
          label={t('library.filters.all')}
          onPress={() => {
            setMuscle(undefined)
            setEquipment(undefined)
            setFavoritesOnly(false)
          }}
          selected={!muscle && !equipment && !favoritesOnly}
        />
        <Chip
          label={t('library.filters.favorites')}
          md="star"
          onPress={() => setFavoritesOnly(!favoritesOnly)}
          selected={favoritesOnly}
          sf="star"
        />
        {MUSCLES.map((m) => (
          <Chip
            key={m}
            label={t(`muscle.${m}`)}
            onPress={() => setMuscle(muscle === m ? undefined : m)}
            selected={muscle === m}
          />
        ))}
      </ScrollView>
      <ScrollView
        contentContainerStyle={styles.filters}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {EQUIPMENT.map((e) => (
          <Chip
            key={e}
            label={t(`equipment.${e}`)}
            onPress={() => setEquipment(equipment === e ? undefined : e)}
            selected={equipment === e}
          />
        ))}
      </ScrollView>
    </View>
  )

  const footer = (
    <View style={styles.footer}>
      <Chip
        label={t('library.archived')}
        md="inventory_2"
        onPress={() => setIncludeArchived(!includeArchived)}
        selected={includeArchived}
        sf="archivebox"
      />
    </View>
  )

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => <HeaderAdd />,
          headerSearchBarOptions: {
            autoCapitalize: 'none',
            hideWhenScrolling: false,
            onChangeText: (e) => setQ(e.nativeEvent.text),
            placeholder: t('library.search'),
          },
        }}
      />
      {/* Sin layout animations a propósito: la lista se rearma en cada tecla (§7.5). */}
      <FlashList
        ListEmptyComponent={noResults}
        ListFooterComponent={footer}
        ListHeaderComponent={filters}
        contentInsetAdjustmentBehavior="automatic"
        data={items}
        keyExtractor={keyExtractor}
        keyboardDismissMode="on-drag"
        maintainVisibleContentPosition={KEEP_POSITION_OFF}
        renderItem={renderItem}
        style={styles.list}
      />
    </>
  )
}

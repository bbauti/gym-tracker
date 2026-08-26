import { FlashList, type FlashListRef } from '@shopify/flash-list'
import { router, useLocalSearchParams } from 'expo-router'
import { SymbolView } from 'expo-symbols'
import { useEffect, useRef, useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  type Exercise,
  exerciseName,
  getExercise,
  listExercises,
  recentExercises,
  searchExercises,
} from '@/db/queries/exercises'
import { addExercise, getSessionExercise, swapExercise } from '@/db/queries/session'
import { useQuery } from '@/db/useQuery'
import { locale, t } from '@/i18n'
import ListRow from '@/ui/ListRow'
import PressableScale from '@/ui/PressableScale'
import Text from '@/ui/Text'
import { colors, MIN_TARGET, radius, spacing } from '@/ui/tokens'

const RECENTS = 8

// FlashList 2 lo trae prendido: acá cada tecla es otra lista, no un chat al que le llegan
// mensajes arriba, y anclar la posición deja el scroll en cualquier lado.
const NO_ANCHOR = { disabled: true }

type Row =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'exercise'; key: string; exercise: Exercise }
  | { kind: 'create'; key: string; name: string }

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[3],
  },
  cancel: { paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: MIN_TARGET,
    marginHorizontal: spacing[4],
    marginBottom: spacing[3],
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.fill,
  },
  input: {
    flex: 1,
    paddingVertical: spacing[2],
    fontSize: 17,
    lineHeight: 22,
    color: colors.label,
  },
  section: {
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[2],
  },
})

const subtitle = (e: Exercise) =>
  `${t(`muscle.${e.primaryMuscle}`)} · ${t(`equipment.${e.equipment}`)}`

// ponytail: "igual" = mismo texto ignorando mayúsculas. Techo: "extension" vs "extensión" ofrece
// crear un duplicado. Upgrade: normalizar acentos (NFD) si molesta de verdad.
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function buildRows(query: string, results: Exercise[], recents: Exercise[]): Row[] {
  const rows: Row[] = []
  if (!query) {
    if (recents.length > 0) {
      rows.push({ kind: 'header', key: 'h:recents', title: t('pick.recents') })
      for (const e of recents) rows.push({ kind: 'exercise', key: `recent:${e.id}`, exercise: e })
      rows.push({ kind: 'header', key: 'h:all', title: t('pick.all') })
    }
    for (const e of results) rows.push({ kind: 'exercise', key: `all:${e.id}`, exercise: e })
    return rows
  }
  for (const e of results) rows.push({ kind: 'exercise', key: `all:${e.id}`, exercise: e })
  if (!results.some((e) => same(e.nameEs, query) || same(e.nameEn, query))) {
    rows.push({ kind: 'create', key: 'create', name: query })
  }
  return rows
}

const keyExtractor = (row: Row) => row.key
const getItemType = (row: Row) => row.kind

export default function PickExerciseScreen() {
  // Con seId la sheet reemplaza el ejercicio de esa fila; con sessionId lo agrega al final.
  const { sessionId, seId } = useLocalSearchParams<{ sessionId: string; seId: string }>()
  const insets = useSafeAreaInsets()
  const list = useRef<FlashListRef<Row>>(null)
  const [q, setQ] = useState('')
  const query = q.trim()

  // Reemplazar se queda con las series ya cargadas, así que solo se ofrecen ejercicios que miden
  // lo mismo: cambiar un peso×reps por uno de tiempo dejaría esos kilos invisibles en la fila pero
  // igual sumando volumen. Agregar (sessionId) no filtra nada.
  const metric = useQuery(
    () => {
      if (!seId) return null
      const se = getSessionExercise(Number(seId))
      return se ? (getExercise(se.exerciseId)?.metric ?? null) : null
    },
    ['session_exercise', 'exercise'],
    [seId],
  )

  const results = useQuery(
    () => {
      const list = query ? searchExercises(query, locale) : listExercises({ locale })
      return metric ? list.filter((e) => e.metric === metric) : list
    },
    ['exercise'],
    [query, metric],
  )
  const recents = useQuery(
    () => {
      if (query) return []
      const list = recentExercises(RECENTS)
      return metric ? list.filter((e) => e.metric === metric) : list
    },
    ['exercise', 'session_exercise', 'session'],
    [query, metric],
  )
  const rows = buildRows(query, results, recents)

  // Cada tecla arma otra lista: sin esto seguís mirando el scroll de la búsqueda anterior.
  // Sin animación, que es lo que pide §7.6 para esta pantalla.
  // biome-ignore lint/correctness/useExhaustiveDependencies: el efecto reacciona a `query`, no lo lee
  useEffect(() => {
    list.current?.scrollToTop({ animated: false })
  }, [query])

  const pick = (exerciseId: number) => {
    // Elegir un ejercicio es rutina: sin háptico (§7.4).
    if (seId) swapExercise(Number(seId), exerciseId)
    else if (sessionId) addExercise(Number(sessionId), exerciseId)
    router.back()
  }

  const renderItem = ({ item }: { item: Row }) => {
    if (item.kind === 'header')
      return (
        <Text accessibilityRole="header" color="secondary" role="footnote" style={styles.section}>
          {item.title}
        </Text>
      )
    if (item.kind === 'create')
      return (
        <ListRow
          onPress={() => router.push({ pathname: '/exercise/new', params: { name: item.name } })}
          title={t('pick.create', { name: item.name })}
        />
      )
    return (
      <ListRow
        onPress={() => pick(item.exercise.id)}
        subtitle={subtitle(item.exercise)}
        title={exerciseName(item.exercise, locale)}
      />
    )
  }

  return (
    // La sheet no tiene header propio (el Stack la registra sin él): el título va acá adentro.
    // `automaticOffset` mide la posición real en pantalla; sin eso, dentro de un formSheet la
    // KeyboardAvoidingView cree que arranca en y=0 y no compensa nada.
    <KeyboardAvoidingView automaticOffset behavior="padding" style={styles.screen}>
      <View style={styles.head}>
        <Text accessibilityRole="header" role="headline">
          {seId ? t('pick.swap') : t('pick.title')}
        </Text>
        <PressableScale
          accessibilityLabel={t('common.cancel')}
          onPress={() => router.back()}
          style={styles.cancel}
        >
          <Text color="tint" role="headline">
            {t('common.cancel')}
          </Text>
        </PressableScale>
      </View>

      {/* headerSearchBarOptions es del header nativo del Stack y acá no hay header: campo propio. */}
      <View style={styles.field}>
        <SymbolView
          fallback={null}
          name={{ ios: 'magnifyingglass', android: 'search' }}
          size={16}
          tintColor={colors.secondaryLabel}
        />
        <TextInput
          accessibilityLabel={t('pick.search')}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          // ponytail: el botón de limpiar es el nativo de iOS. Techo: en Android se borra a mano.
          clearButtonMode="while-editing"
          maxFontSizeMultiplier={1.6}
          onChangeText={setQ}
          placeholder={t('pick.search')}
          placeholderTextColor={colors.tertiaryLabel}
          returnKeyType="search"
          style={styles.input}
          value={q}
        />
      </View>

      {/* Nada de layout animations: la lista se rearma en cada tecla (§7.5). */}
      <FlashList
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing[4] }}
        data={rows}
        getItemType={getItemType}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={keyExtractor}
        maintainVisibleContentPosition={NO_ANCHOR}
        ref={list}
        renderItem={renderItem}
      />
    </KeyboardAvoidingView>
  )
}

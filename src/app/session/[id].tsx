import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { router, Stack, useIsFocused, useLocalSearchParams } from 'expo-router'
import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import { useEffect, useRef, useState } from 'react'
import { Alert, AppState, Dimensions, StyleSheet, View } from 'react-native'
import Animated, {
  useAnimatedRef,
  useAnimatedStyle,
  useScrollViewOffset,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { exerciseName } from '@/db/queries/exercises'
import { activeGym } from '@/db/queries/gyms'
import { getRoutineDay } from '@/db/queries/routines'
import {
  clearRest,
  deleteSession,
  endSession,
  getSession,
  getSessionTree,
  lastCompletedAt,
  pauseSession,
  type SetRow as Row,
  removeSessionExercise,
  reorderExercises,
  restoreSessionExercise,
  resumeSession,
  type SessionTree,
  setRestEndsAt,
} from '@/db/queries/session'
import {
  addSet,
  addWarmupSets,
  completeSet,
  deleteSet,
  prevSets,
  restoreSet,
  type SetPatch,
  uncompleteSet,
  updateSet,
} from '@/db/queries/sets'
import { getSettings, type Settings } from '@/db/queries/settings'
import { sessionVolume } from '@/db/queries/stats'
import { SET_KINDS, type SetKind } from '@/db/schema'
import { type Field, type Focus, fieldsFor, type NumKey } from '@/db/types'
import { useQuery } from '@/db/useQuery'
import { locale, plural, t } from '@/i18n'
import { DEFAULT_BAR_G, DEFAULT_PLATES_G } from '@/lib/plates'
import type { PrKind } from '@/lib/prs'
import { adjustRestEndsAt, elapsedMs } from '@/lib/rest'
import {
  defaultIncrementG,
  formatDuration,
  formatWeight,
  gToUnit,
  parseWeight,
  type Unit,
} from '@/lib/units'
import { warmupRamp } from '@/lib/warmup'
import {
  cancelRestEnd,
  dismissSessionNotification,
  scheduleRestEnd,
  showSessionNotification,
} from '@/notifications'
import { MAX_CARD_EXERCISES, shareSession } from '@/share'
import Badge from '@/ui/Badge'
import Button from '@/ui/Button'
import Card from '@/ui/Card'
import { celebration } from '@/ui/Celebration'
import EmptyState from '@/ui/EmptyState'
import { haptic } from '@/ui/haptics'
import IconButton from '@/ui/IconButton'
import Menu, { type MenuItem, showMenu } from '@/ui/Menu'
import { RowLayout, Spring, useEnterFade } from '@/ui/motion'
import NumPad from '@/ui/NumPad'
import PressableScale from '@/ui/PressableScale'
import RestTimer, { useNow } from '@/ui/RestTimer'
import SetRow, { fieldLabel, fieldNumber, ghostNumber, hasValue, SET_COLUMNS } from '@/ui/SetRow'
import Sortable, { type ReorderActions } from '@/ui/Sortable'
import SwipeRow from '@/ui/SwipeRow'
import Text from '@/ui/Text'
import { toast } from '@/ui/Toast'
import { colors, MIN_TARGET, opacity, radius, spacing } from '@/ui/tokens'

const SESSION_TABLES = ['session', 'session_exercise', 'set_entry', 'exercise']
const SETTINGS_TABLES = ['settings']
/** El descanso arranca en la última serie completada: el MAX(completed_at) es el único dato nuevo. */
const REST_TABLES = ['set_entry']
/** D11: el día de rutina se puede marcar/desmarcar como deload mientras la sesión está abierta. */
const ROUTINE_DAY_TABLES = ['routine_day']
/** Los ghosts son de sesiones anteriores: no cambian mientras entrenás. */
const NO_TABLES: string[] = []
const KEEP_AWAKE_TAG = 'gym-session'
/** Identidad estable: sin récords las cards reciben siempre el mismo mapa y no se re-renderizan. */
const NO_PRS: ReadonlyMap<number, PrKind[]> = new Map()
const NO_KINDS: PrKind[] = []
const MAX_DRAFT = 6
/** Alto con el que arranca el numpad hasta que mide: cualquier valor que lo deje fuera de pantalla. */
const PAD_GUESS = 400
// Portrait-only (app.json): el alto de ventana a nivel módulo no se queda viejo.
const SCREEN_H = Dimensions.get('window').height
/** Lo que tiene que quedar libre bajo el dedo al enfocar: la fila entera (56) y un respiro. */
const ROW_CLEARANCE = 56 + spacing[4]
// El orden es el mismo criterio que en `SET_MENU`: primero lo que más se usa (ver ui/Menu.tsx).
const EXERCISE_MENU: MenuItem[] = [
  { key: 'note', label: t('session.exerciseMenu.note'), md: 'edit_note', sf: 'square.and.pencil' },
  {
    key: 'warmup',
    label: t('session.exerciseMenu.warmup'),
    md: 'local_fire_department',
    sf: 'flame',
    // Sin peso de trabajo el handler dispara `error`, y el tic del menú se lo comería (gate global).
    skipTick: true,
  },
  {
    key: 'feedback',
    label: t('session.exerciseMenu.feedback'),
    md: 'thumb_up',
    sf: 'hand.thumbsup',
  },
  {
    key: 'swap',
    label: t('session.exerciseMenu.swap'),
    md: 'swap_horiz',
    sf: 'arrow.2.squarepath',
  },
  {
    destructive: true,
    key: 'remove',
    label: t('session.exerciseMenu.remove'),
    md: 'delete',
    sf: 'trash',
  },
]

// El orden importa: en Android el menú se corta a las dos primeras acciones (ver ui/Menu.tsx).
// "Borrar" cierra el menú y es, además, la única forma accesible de borrar una serie: el swipe vive
// en un contenedor que VoiceOver no enfoca porque adentro hay celdas enfocables.
const SET_MENU: MenuItem[] = [
  ...SET_KINDS.map((k) => ({ key: `kind:${k}`, label: t(`setKind.${k}`) })),
  { key: 'note', label: t('session.set.menu.note'), md: 'edit_note', sf: 'square.and.pencil' },
  ...(['none', 'left', 'right'] as const).map((s) => ({
    key: `side:${s}`,
    label: `${t('session.set.menu.side')}: ${t(`session.set.side.${s}`)}`,
  })),
  { destructive: true, key: 'delete', label: t('common.delete'), md: 'delete', sf: 'trash' },
]

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.groupedBackground, flex: 1 },
  // Sin `gap`: la separación entre cards vive adentro de `cardSlot` porque el hueco de la card
  // levantada tiene que viajar con ella (ver ui/Sortable.tsx).
  content: { padding: spacing[4] },
  cardSlot: { paddingBottom: spacing[4] },
  empty: { marginBottom: spacing[4], minHeight: 240 },
  // Mismo aviso que en el editor del día (app/routine-day/[id].tsx), acá arriba de los ejercicios.
  deload: {
    borderRadius: radius.md,
    borderCurve: 'continuous',
    gap: spacing[2],
    marginBottom: spacing[4],
    overflow: 'hidden',
    padding: spacing[3],
  },
  // El lavado va como capa: ningún `colors.*` acepta alpha (son PlatformColor), igual que en Badge.
  deloadWash: { backgroundColor: colors.warning, opacity: opacity.wash },
  card: { gap: spacing[2] },
  cardHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing[2] },
  cardTitle: { flex: 1 },
  more: {
    alignItems: 'center',
    minHeight: MIN_TARGET,
    justifyContent: 'center',
    width: MIN_TARGET,
  },
  columns: { alignItems: 'center', flexDirection: 'row', gap: spacing[1] },
  colBadge: { textAlign: 'center', width: SET_COLUMNS.badge },
  colPrev: { flex: SET_COLUMNS.prevFlex, textAlign: 'center' },
  colField: { flex: SET_COLUMNS.cellFlex, textAlign: 'center' },
  colCheck: { width: SET_COLUMNS.check },
  addSet: { alignItems: 'center', justifyContent: 'center', minHeight: MIN_TARGET },
  feedbackCta: { alignItems: 'center', justifyContent: 'center', minHeight: MIN_TARGET },
  note: { paddingBottom: spacing[1] },
  pad: { bottom: 0, left: 0, position: 'absolute', right: 0 },
  rest: { bottom: 0, left: 0, position: 'absolute', right: 0 },
  elapsed: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing[2],
    paddingBottom: spacing[3],
  },
})

/** El texto tipeado a columna. `null` = no se puede escribir eso (y no se escribe nada). */
function parseDraft(field: Field, text: string, unit: Unit): SetPatch | null {
  if (text === '') return null
  const n = Number(text.replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) return null
  switch (field) {
    case 'weight': {
      const g = parseWeight(text, unit)
      return g === null ? null : { weightG: g }
    }
    case 'reps':
      return { reps: Math.round(n) }
    // ponytail: la duración se tipea en segundos (90 -> 1:30 al confirmar), no en mm:ss.
    // Techo: escribir 3 minutos son tres teclas raras (180). Upgrade: modo mm:ss en el numpad.
    case 'duration':
      return { durationMs: Math.round(n) * 1000 }
    case 'distance':
      return { distanceMm: Math.round(n * 1000) }
    case 'rpe':
      return { rpe: Math.min(10, Math.max(1, n)) }
    case 'rir':
      return { rir: Math.round(n) }
  }
}

/** Copia el valor de una columna tal cual (los ghosts se confirman sin pasar por texto). */
function columnPatch(field: Field, from: Row): SetPatch {
  switch (field) {
    case 'weight':
      return { weightG: from.weightG }
    case 'reps':
      return { reps: from.reps }
    case 'duration':
      return { durationMs: from.durationMs }
    case 'distance':
      return { distanceMm: from.distanceMm }
    case 'rpe':
      return { rpe: from.rpe }
    case 'rir':
      return { rir: from.rir }
  }
}

const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'long' })

/** Más peso gana; a igual peso, más repeticiones; y si el ejercicio no lleva peso, más tiempo. */
function better(a: Row, b: Row): boolean {
  const weight = (a.weightG ?? 0) - (b.weightG ?? 0)
  if (weight !== 0) return weight > 0
  const reps = (a.reps ?? 0) - (b.reps ?? 0)
  if (reps !== 0) return reps > 0
  return (a.durationMs ?? a.distanceMm ?? 0) > (b.durationMs ?? b.distanceMm ?? 0)
}

/**
 * La mejor serie del ejercicio en una línea ("100 kg × 8"), para la imagen que se comparte. `null`
 * cuando no se completó nada: un ejercicio sin series hechas no entra en la tarjeta.
 *
 * Con unidad, a diferencia de la tabla de la pantalla: la imagen se mira fuera de la app y ahí no
 * hay encabezado de columna que diga si son kg o lb.
 */
function bestLine(sets: Row[], unit: Unit): string | null {
  let best: Row | null = null
  for (const set of sets) {
    if (set.completedAt === null || set.kind === 'warmup') continue
    if (best === null || better(set, best)) best = set
  }
  if (best === null) return null
  const weight = best.weightG === null ? null : formatWeight(best.weightG, unit, locale)
  if (weight !== null && best.reps !== null) return `${weight} × ${best.reps}`
  if (best.reps !== null) return `${best.reps} ${t('session.reps')}`
  return weight ?? (best.durationMs === null ? null : formatDuration(best.durationMs))
}

type Found = { ex: SessionTree['exercises'][number]; set: Row; index: number }

function findSet(tree: SessionTree, setId: number): Found | null {
  for (const ex of tree.exercises) {
    const index = ex.sets.findIndex((s) => s.id === setId)
    if (index >= 0) return { ex, index, set: ex.sets[index] }
  }
  return null
}

/**
 * El fantasma de una fila. Los ghosts (`prevSets`, ya sin entradas en calor) se alinean por posición
 * ENTRE LAS SERIES DE TRABAJO, no por índice absoluto: una rampa agregada a mitad de sesión mete
 * filas arriba y correría a todas las de trabajo contra el fantasma de otra serie (o contra ninguno,
 * y sin él tildar dejaría de heredar las reps de la vez anterior).
 */
/** Índice 0-based para etiquetar cada serie: trabajo y calentamiento llevan cuentas separadas. */
function ordinalsOf(sets: Row[]): number[] {
  let work = 0
  let warm = 0
  return sets.map((s) => (s.kind === 'warmup' ? warm++ : work++))
}

function ghostFor(sets: Row[], index: number, ghosts: Row[]): Row | null {
  if (sets[index]?.kind === 'warmup') return null
  let work = 0
  for (let i = 0; i < index; i++) if (sets[i].kind !== 'warmup') work++
  return ghosts[work] ?? null
}

/** El paso de −/+ del campo. `null` = ese campo no tiene stepper (duración, distancia). */
function stepOf(field: Field, incrementG: number, unit: Unit): number | null {
  if (field === 'duration' || field === 'distance') return null
  if (field !== 'weight') return 1
  // El incremento se guarda en gramos: en lb el default ya viene en 2268 g, así que da 5 redondo.
  return Math.round(gToUnit(incrementG, unit) * 100) / 100
}

/** Cadena "siguiente": los campos del ejercicio y después la primera columna de la serie de abajo. */
function nextFocusOf(tree: SessionTree, pad: Focus | null): Focus | null {
  if (!pad) return null
  const found = findSet(tree, pad.setId)
  if (!found) return null
  const chain = fieldsFor(found.ex.exercise.metric)
  const i = chain.indexOf(pad.field)
  if (i >= 0 && i + 1 < chain.length) return { field: chain[i + 1], setId: pad.setId }
  const next = found.ex.sets[found.index + 1]
  return next ? { field: chain[0], setId: next.id } : null
}

/** Escribe lo que estaba tipeado. Vive afuera del componente porque lo llaman los effects, que
    tienen que quedarse con una identidad estable (el ref es lo único que no se les queda viejo). */
function flush(live: Live) {
  const { draft, pad, settings } = live
  if (!pad || draft === '') return
  const patch = parseDraft(pad.field, draft, settings.unit)
  if (patch) updateSet(pad.setId, patch)
}

/** Lo que los handlers leen por ref en vez de capturar del render (ver el comentario en la pantalla). */
type Live = {
  draft: string
  ghosts: Map<number, Row[]>
  open: boolean
  pad: Focus | null
  padHeight: number
  restOverlay: number
  settings: Settings
  tree: SessionTree | null
}

function confirm(
  title: string,
  body: string,
  action: string,
  destructive: boolean,
  run: () => void,
) {
  Alert.alert(title, body, [
    { style: 'cancel', text: t('common.cancel') },
    { onPress: run, style: destructive ? 'destructive' : 'default', text: action },
  ])
}

export default function SessionScreen() {
  const params = useLocalSearchParams<{ id: string }>()
  const sessionId = Number(params.id)
  const tree = useQuery(
    () => (Number.isFinite(sessionId) ? getSessionTree(sessionId) : null),
    SESSION_TABLES,
    [sessionId],
  )
  const settings = useQuery(getSettings, SETTINGS_TABLES)

  // `pad` es el último campo enfocado y sobrevive al blur: el numpad sigue mostrando sus teclas
  // mientras baja. `open` es lo que decide si está arriba.
  const [pad, setPad] = useState<Focus | null>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [padHeight, setPadHeight] = useState(0)
  const [restHeight, setRestHeight] = useState(0)
  /** Sube en cada vuelta del background: lo único que hace es re-correr los efectos de las filas. */
  const [resumeKey, setResumeKey] = useState(0)
  /**
   * Los récords que se rompieron en esta pantalla, por serie. `is_pr` ya viaja en el árbol y es lo
   * que dibuja la pastilla; esto es solo el detalle para leerla en voz alta y el registro de lo que
   * ya se festejó (H05: una serie se festeja una vez, aunque se destilde y se vuelva a tildar).
   */
  const [prKinds, setPrKinds] = useState<ReadonlyMap<number, PrKind[]>>(NO_PRS)
  const shown = useSharedValue(0)
  const insets = useSafeAreaInsets()
  // El inicio del descanso es derivable: la última serie completada de la sesión. Sin columna nueva.
  const restStartedAt = useQuery(() => lastCompletedAt(sessionId), REST_TABLES, [sessionId])
  // D11: el consejo del deload ("bajá el peso, no las series") sirve donde se levanta el peso, no
  // solo en la pantalla donde se planifica. Sale del join que ya existe (`session.routine_day_id`):
  // sin columna nueva en `session` y sin copiar el flag al empezar.
  const routineDayId = tree?.session.routineDayId ?? null
  const deload = useQuery(
    () => (routineDayId === null ? false : (getRoutineDay(routineDayId)?.isDeload ?? false)),
    ROUTINE_DAY_TABLES,
    [routineDayId],
  )
  // El sortable necesita el ref del scroll para auto-scrollear al arrastrar contra un borde.
  const scrollRef = useAnimatedRef<Animated.ScrollView>()
  const offset = useScrollViewOffset(scrollRef)
  // Solo la card recién agregada entra con fade: abrir una sesión vieja con 6 ejercicios no es una
  // entrada, es una pantalla que ya estaba (mismo motivo que el tilde de `ui/SetRow`).
  const fadeIn = useEnterFade((tree?.exercises ?? []).map((e) => e.se.id))

  // Un solo read por lista de ejercicios: el numpad (±, plates) y completar necesitan los ghosts,
  // y un useQuery por card no se puede leer desde acá. La clave encierra todo lo que `run` usa.
  const exercises = tree?.exercises
  const ghostKey = (exercises ?? []).map((e) => `${e.se.id}:${e.exercise.id}`).join(',')
  const ghosts = useQuery(
    () => new Map((exercises ?? []).map((e) => [e.se.id, prevSets(e.exercise.id, sessionId)])),
    NO_TABLES,
    [ghostKey, sessionId],
  )

  // Todo lo que cambia mientras tipeás vive también en este ref: los handlers lo leen en vez de
  // capturar el estado, así conservan identidad entre teclas y el compilador puede devolver el
  // árbol cacheado de las cards que no cambiaron (§5.4: una tecla re-renderiza card + fila +
  // numpad). Se escribe en los `put*` y se sincroniza después de cada commit; escribirlo EN RENDER
  // haría que el React Compiler no compile la pantalla y no quedaría nada memoizado.
  // `Date.now()` en render no es reactivo a propósito: mientras el descanso corre, quien lo apaga es
  // el propio RestTimer (onDone limpia la fila y esto se recalcula con el write). En pausa el
  // descanso está congelado, así que la barra no va.
  const restEndsAt = tree?.session.restEndsAt ?? null
  const restRunning =
    restEndsAt !== null && tree?.session.pausedAt === null && restEndsAt > Date.now()
  // Lo que el timer tapa POR ARRIBA del numpad: se lo sube `padHeight - insets.bottom` (ver el
  // `restStyle`), así que le sobresale eso. Va al ref porque lo lee `scrollIntoView`.
  const restOverlay = restRunning ? Math.max(0, restHeight - insets.bottom) : 0

  const live = useRef<Live>({ draft, ghosts, open, pad, padHeight, restOverlay, settings, tree })
  useEffect(() => {
    live.current = { draft, ghosts, open, pad, padHeight, restOverlay, settings, tree }
  })

  const active = tree !== null && tree.session.endedAt === null
  useEffect(() => {
    if (!active) return
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {})
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {})
    }
  }, [active])

  useEffect(() => {
    shown.set(withSpring(open ? 1 : 0, Spring.sheet))
  }, [open, shown])

  // Confirmar lo tipeado al irse la app a background: sin esto un swipe hacia arriba pierde el draft.
  // Al volver, `resumeKey` re-dispara los efectos de las filas: una animación de Reanimated que
  // arrancó con la app atrás (el diálogo de permisos de Android, una llamada) nunca progresó y el
  // tilde se quedó a medio pintar aunque la serie esté completada. Re-apuntar los shared values al
  // target los deja donde ya estaban cuando la animación sí corrió: no se ve nada.
  //
  // L04: la misma transición postea (y al volver baja) la notificación pegada del entrenamiento —
  // con la app atrás el JS puede quedar suspendido, así que este es el único momento seguro para
  // escribirla. Lee del ref y no del render a propósito: si el efecto se re-suscribiera al cambiar
  // `rest_ends_at`, su cleanup bajaría la sticky que el botón +15 s acaba de reponer.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setResumeKey((k) => k + 1)
        dismissSessionNotification().catch(() => {})
        return
      }
      flush(live.current)
      // iOS manda 'inactive' al bajar el centro de control: eso no es irse de la app.
      if (state !== 'background') return
      const s = live.current.tree?.session
      if (!s || s.endedAt !== null) return
      // En pausa el descanso está congelado: sin `restEndsAt` la sticky no ofrece saltar lo que no corre.
      showSessionNotification({
        name: s.name,
        restEndsAt: s.pausedAt === null ? s.restEndsAt : null,
        sessionId,
      }).catch(() => {})
    })
    return () => {
      sub.remove()
      dismissSessionNotification().catch(() => {})
    }
  }, [sessionId])

  // Y al irse de la pantalla: el back del header y el swipe de iOS desmontan con el draft todavía
  // en React. Terminar es el peor caso — `endSession` barre la serie que quedó sin valores y, si
  // era la única del ejercicio, se lleva el ejercicio entero.
  useEffect(() => () => flush(live.current), [])

  const padStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - shown.get()) * (padHeight > 0 ? padHeight : PAD_GUESS) }],
  }))

  // El timer se sube arriba del numpad con el mismo shared value que lo abre (interrumpible, sin un
  // segundo reloj). Se sube `padHeight - insets.bottom` y no `padHeight`: así el respiro inferior del
  // timer queda tapado por el numpad en vez de dejar un colchón de card entre los dos.
  const restStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -shown.get() * Math.max(0, padHeight - insets.bottom) }],
  }))

  if (!tree) return null

  const row = tree.session
  const paused = row.pausedAt !== null
  const found = pad ? findSet(tree, pad.setId) : null
  const padIncrementG = found?.ex.exercise.defaultIncrementG ?? defaultIncrementG(settings.unit)
  const padStep = pad ? stepOf(pad.field, padIncrementG, settings.unit) : null
  // El peso se etiqueta desde los gramos (así "5 lb" no vuelve como 5,0000844), el resto es entero.
  const padLabel =
    padStep === null
      ? null
      : pad?.field === 'weight'
        ? formatWeight(padIncrementG, settings.unit, locale, { withUnit: false })
        : String(padStep)

  // Estado y ref se escriben juntos: el ref para el handler que viene, el estado para el render.
  const putDraft = (typed: string) => {
    live.current.draft = typed
    setDraft(typed)
  }
  const putPad = (next: Focus) => {
    live.current.pad = next
    setPad(next)
  }
  const putOpen = (value: boolean) => {
    live.current.open = value
    setOpen(value)
  }

  const commit = () => {
    flush(live.current)
    putDraft('')
  }

  // El numpad tapa el tercio de abajo (y con un descanso corriendo, la barra tapa otro tanto arriba
  // del numpad): si la celda que tocaste cae ahí, se sube el scroll lo justo. `pageY` es dónde cayó
  // el dedo (lo reenvía SetRow); sin eso habría que medir cada fila.
  const scrollIntoView = (pageY: number) => {
    const { padHeight: ph, restOverlay: overlay } = live.current
    const overlap = pageY + ROW_CLEARANCE - (SCREEN_H - (ph || PAD_GUESS) - overlay)
    if (overlap > 0) scrollRef.current?.scrollTo({ animated: true, y: offset.get() + overlap })
  }

  const focusOn = (setId: number, field: Field, pageY: number) => {
    commit()
    putPad({ field, setId })
    putOpen(true)
    putDraft('')
    scrollIntoView(pageY)
  }

  const blur = () => {
    commit()
    putOpen(false)
  }

  // La notificación la programa la pantalla y no `completeSet`: es la única que sabe si el descanso
  // sigue vivo (saltarlo, ±15 s, pausar). El primer `scheduleRestEnd` del teléfono es también el que
  // pide el permiso — nunca al arrancar la app. Si lo niegan, esto es un no-op silencioso.
  const scheduleRest = (endsAt: number) => {
    scheduleRestEnd(endsAt).catch(() => {})
  }

  /** Saltar, llegar a 0 y terminar son lo mismo: la fila se limpia y la notificación se cancela. */
  const endRest = () => {
    clearRest(sessionId)
    cancelRestEnd().catch(() => {})
  }

  const adjustRest = (deltaMs: number) => {
    // La fila y no `live.current`: `useQuery` difiere la invalidación un `setTimeout(0)`, así que dos
    // toques en el mismo turno (un doble tap, un frame lento) leerían los dos el valor viejo y el
    // segundo pisaría al primero — +30 s quedarían en +15 s, con la notificación en el instante malo.
    const current = getSession(sessionId)?.restEndsAt
    if (current == null) return
    const next = adjustRestEndsAt(current, deltaMs, Date.now())
    setRestEndsAt(sessionId, next)
    scheduleRest(next)
  }

  const handleKey = (k: NumKey) => {
    const { draft: typed, ghosts: prevs, pad: at, settings: config, tree: now } = live.current
    if (!at || !now) return
    const target = findSet(now, at.setId)
    // La serie enfocada desapareció (la borró un swipe): el numpad se baja en vez de quedar inerte.
    if (!target) {
      putDraft('')
      putOpen(false)
      return
    }
    const ghost = ghostFor(target.ex.sets, target.index, prevs.get(target.ex.se.id) ?? [])
    const unit = config.unit
    const field = at.field
    switch (k) {
      case 'backspace': {
        if (typed !== '') {
          putDraft(typed.slice(0, -1))
          return
        }
        const n =
          fieldNumber(field, target.set, unit) ?? ghostNumber(field, target.set, ghost, unit)
        putDraft(n === null ? '' : String(n).slice(0, -1))
        return
      }
      case 'minus':
      case 'plus': {
        const step = stepOf(
          field,
          target.ex.exercise.defaultIncrementG ?? defaultIncrementG(unit),
          unit,
        )
        if (step === null) return
        const base =
          typed !== ''
            ? Number(typed.replace(',', '.'))
            : (fieldNumber(field, target.set, unit) ??
              ghostNumber(field, target.set, ghost, unit) ??
              0)
        if (!Number.isFinite(base)) return
        const next = Math.max(0, Math.round((base + (k === 'plus' ? step : -step)) * 100) / 100)
        putDraft(String(next))
        return
      }
      case 'plates': {
        const parsed = typed === '' ? null : parseWeight(typed, unit)
        const weightG =
          parsed ?? target.set.weightG ?? target.set.suggestedWeightG ?? ghost?.weightG ?? 0
        router.push({ params: { weightG }, pathname: '/plates' })
        return
      }
      case 'next': {
        commit()
        const next = nextFocusOf(now, at)
        if (next) putPad(next)
        else putOpen(false)
        return
      }
      case 'done':
        blur()
        return
      case '.': {
        if (typed.includes('.') || typed.length >= MAX_DRAFT) return
        putDraft(typed === '' ? '0.' : `${typed}.`)
        return
      }
      default: {
        if (typed.length >= MAX_DRAFT) return
        putDraft(typed === '0' ? k : `${typed}${k}`)
      }
    }
  }

  const handleComplete = (setId: number, pageY: number) => {
    const { draft: typed, ghosts: prevs, pad: at, settings: config, tree: now } = live.current
    if (!now) return
    const target = findSet(now, setId)
    if (!target) return
    const { ex, set, index } = target
    if (set.completedAt !== null) {
      haptic('setUncomplete')
      uncompleteSet(setId)
      // El descanso lo arrancó la última serie completada: si es justo esa la que se destildó, se
      // queda sin dueño — `restStartedAt` cae a una serie más vieja (o a `startedAt`) y la barra
      // pasaría a dibujarse contra un total inventado, con la notificación igual de viva.
      if (restEndsAt !== null && set.completedAt === restStartedAt) endRest()
      return
    }
    // Los campos sin tocar se confirman solos, con la misma precedencia que dibuja la celda: el
    // peso que sugirió la rutina primero, después lo de la vez anterior. Lo tipeado pisa a los dos.
    // Un solo write.
    const fill: SetPatch = {}
    const prev = ghostFor(ex.sets, index, prevs.get(ex.se.id) ?? [])
    const fields = fieldsFor(ex.exercise.metric)
    for (const field of fields) {
      if (hasValue(field, set)) continue
      if (field === 'weight' && set.suggestedWeightG !== null) {
        fill.weightG = set.suggestedWeightG
        continue
      }
      if (prev && hasValue(field, prev)) Object.assign(fill, columnPatch(field, prev))
    }
    if (at?.setId === setId && typed !== '')
      Object.assign(fill, parseDraft(at.field, typed, config.unit))
    // El objetivo del día es un fantasma y nada más (§2.2: la app sugiere, nunca aplica): una serie
    // sin repeticiones y sin ghost previo del que heredarlas no se completa con "8–12". Se rebota
    // con el numpad ya puesto sobre las reps, que es lo único que falta para poder tildarla.
    if (fields.includes('reps') && (set.reps ?? fill.reps ?? null) === null) {
      haptic('error')
      // El ToastHost es un overlay del layout raíz y se dibuja SOBRE el numpad: sin el inset taparía
      // (y se comería los taps de) la última fila de teclas, que es justo lo que este aviso pide
      // tocar. `padHeight` ya está medido — el numpad se monta con la pantalla, aunque esté abajo.
      toast.show({ bottom: live.current.padHeight, text: t('session.needReps') })
      focusOn(setId, 'reps', pageY)
      return
    }
    const last = ex.sets.every((s) => s.id === setId || s.completedAt !== null)
    // El descanso que pedía la rutina primero (copiado a la fila al pre-cargar el día, D07), después
    // el del ejercicio y por último el de ajustes.
    const restSec = ex.se.restSec ?? ex.exercise.defaultRestSec ?? config.defaultRestSec
    // Acá el háptico va DESPUÉS del write y no antes (borrar lo hace al revés): cuál suena depende
    // de si la serie rompió un récord, y eso lo contesta el write. Es sync y son dos queries.
    const kinds = completeSet(setId, sessionId, fill, restSec)
    // Tier 1 y nada más (§7.5): la pastilla de la fila y un aviso. Sin confetti, y una sola vez por
    // serie — destildar y volver a tildar reproduce el récord en la base, pero no es un récord nuevo.
    const celebrate = kinds.length > 0 && !prKinds.has(setId)
    haptic(celebrate ? 'pr' : last ? 'exerciseDone' : 'setComplete')
    // Sin toast: el tier 1 es la pastilla de la fila y el háptico, nada más. Un toast acá además
    // pisaba el de deshacer de un borrado (`Toast` muestra uno solo a la vez, el nuevo reemplaza al
    // viejo), y con eso la única celebración de la app se comía la única forma de recuperar datos.
    if (celebrate) setPrKinds((seen) => new Map(seen).set(setId, kinds))
    // Contra el `rest_ends_at` que acabó de escribir `completeSet` (guarda su propio `now` adentro de
    // la transacción) y no contra un `Date.now()` nuevo: el aviso y el cero de la pantalla son el
    // mismo instante, no dos que se separan si cae un frame lento en el medio. Un descanso de 0 s no
    // es un descanso.
    const endsAt = getSession(sessionId)?.restEndsAt
    if (restSec > 0 && endsAt != null) scheduleRest(endsAt)
    if (at?.setId === setId) {
      putDraft('')
      putOpen(false)
    }
  }

  // Sin diálogo (§7.5): se borra y queda el toast de deshacer. El háptico va antes del write,
  // en el mismo bloque, porque el write re-renderiza la lista de una. Borrar baja el numpad
  // (confirmando lo tipeado): el toast vive abajo de todo y si no lo taparía.
  const handleDeleteSet = (setId: number) => {
    if (live.current.open) blur()
    haptic('delete')
    const deleted = deleteSet(setId)
    toast.show({
      actionLabel: t('common.undo'),
      onAction: () => {
        haptic('undo')
        restoreSet(deleted)
      },
      text: t('session.setDeleted'),
    })
  }

  const handleSetMenu = (setId: number) => {
    const now = live.current.tree
    const target = now ? findSet(now, setId) : null
    if (!target) return
    showMenu({
      items: SET_MENU,
      onSelect: (key) => {
        if (key === 'note') {
          router.push({ params: { setId }, pathname: '/note' })
          return
        }
        if (key === 'delete') {
          handleDeleteSet(setId)
          return
        }
        const [group, value] = key.split(':')
        if (group === 'kind') updateSet(setId, { kind: value as SetKind })
        else updateSet(setId, { side: value === 'none' ? null : (value as 'left' | 'right') })
      },
      title: exerciseName(target.ex.exercise, locale),
    })
  }

  const handleExerciseMenu = (seId: number, key: string) => {
    if (key === 'note') {
      router.push({ params: { seId }, pathname: '/note' })
      return
    }
    if (key === 'feedback') {
      router.push({ params: { seId }, pathname: '/feedback' })
      return
    }
    // J06. La rampa se calcula con la barra y los discos del gimnasio activo y las series entran
    // ARRIBA de las que ya están. Es una sugerencia aplicada a mano por el usuario (§2.2): la app no
    // las pone sola al precargar el día.
    if (key === 'warmup') {
      const now = live.current.tree
      const ex = now?.exercises.find((e) => e.se.id === seId)
      if (!ex) return
      const work = ex.sets.find((s) => s.kind !== 'warmup')
      const ghost = live.current.ghosts.get(seId) ?? []
      const workG =
        work?.weightG ??
        work?.suggestedWeightG ??
        ghost.find((g) => g.weightG !== null)?.weightG ??
        null
      const gym = activeGym()
      const rows =
        workG === null
          ? []
          : warmupRamp(workG, {
              barG: gym?.barsG?.[0]?.g ?? DEFAULT_BAR_G,
              // Apagar todos los chips deja `[]`, que no carga nada: es la tabla por defecto.
              platesG: gym?.platesG?.length ? gym.platesG : DEFAULT_PLATES_G,
            })
      // Sin peso de trabajo (o con la barra pelada) no hay rampa que armar, y un menú que no hace
      // nada se lee como un bug.
      if (rows.length === 0) {
        haptic('error')
        toast.show({ text: t('session.warmupNeedWeight') })
        return
      }
      addWarmupSets(seId, rows)
      return
    }
    if (key === 'swap') {
      router.push({ params: { seId }, pathname: '/pick-exercise' })
      return
    }
    // Quitar un ejercicio se lleva puestas sus series: sin confirmación pero con deshacer, que
    // restaura la card entera (misma posición, mismas series).
    if (live.current.open) blur()
    haptic('delete')
    const removed = removeSessionExercise(seId)
    if (!removed) return
    toast.show({
      actionLabel: t('common.undo'),
      onAction: () => {
        haptic('undo')
        restoreSessionExercise(removed)
      },
      text: t('session.exerciseRemoved'),
    })
  }

  // N01. La tarjeta se arma con lo que ya está en pantalla; el volumen es la única query (la misma
  // que usa Historial, así que el número coincide). Se dibuja fuera de pantalla y no bloquea nada:
  // si el dispositivo no puede compartir, el aviso va al toast.
  const shareCard = () => {
    const now = live.current.tree
    if (!now) return
    const { unit } = live.current.settings
    const s = now.session
    const lines = now.exercises
      .map((ex) => ({ detail: bestLine(ex.sets, unit), name: exerciseName(ex.exercise, locale) }))
      .filter((line): line is { detail: string; name: string } => line.detail !== null)
    const prs = now.exercises.reduce((n, ex) => n + ex.sets.filter((set) => set.isPr).length, 0)
    const rest = lines.length - MAX_CARD_EXERCISES
    const stats = [
      {
        label: t('history.duration'),
        value: formatDuration(
          elapsedMs(s.startedAt, s.pausedMs, s.pausedAt, s.endedAt ?? Date.now()),
        ),
      },
      {
        label: t('progress.volume'),
        value: formatWeight(sessionVolume(sessionId).volumeG, unit, locale, {
          maxFractionDigits: 0,
        }),
      },
    ]
    // Sin récords no se dibuja la columna: un "0" grande es la lectura más fría de la tarjeta.
    if (prs > 0) stats.push({ label: t('pr.history'), value: String(prs) })
    shareSession({
      date: dateFormat.format(new Date(s.startedAt)),
      exercises: lines.slice(0, MAX_CARD_EXERCISES),
      footer: t('share.footer'),
      more:
        rest > 0
          ? `+${plural(rest, t('history.exercises.one', { n: rest }), t('history.exercises.other', { n: rest }))}`
          : null,
      stats,
      title: s.name ?? t('session.untitled'),
    }).catch(() => toast.show({ text: t('share.unavailable') }))
  }

  const handleHeaderMenu = (key: string) => {
    // Lo primero: confirmar lo que estaba a medio tipear. Terminar con el numpad abierto barría la
    // serie recién escrita (y con ella el ejercicio, si era la única).
    blur()
    if (key === 'share') {
      shareCard()
      return
    }
    if (key === 'edit') {
      router.push({ params: { id: sessionId }, pathname: '/session-edit' })
      return
    }
    // En pausa el cronómetro y el descanso se congelan juntos. ponytail: `resumeSession` corre el
    // `rest_ends_at` hacia adelante lo que duró la pausa, así que el descanso "sigue" donde estaba.
    // Techo: pausar durante un descanso de 3 min y volver a la hora deja el descanso entero por
    // delante. Upgrade: guardar el remaining al pausar y ofrecer "saltar" al reanudar.
    if (key === 'pause') {
      pauseSession(sessionId)
      cancelRestEnd().catch(() => {})
      return
    }
    if (key === 'resume') {
      resumeSession(sessionId)
      const endsAt = getSession(sessionId)?.restEndsAt
      if (endsAt !== null && endsAt !== undefined) scheduleRest(endsAt)
      return
    }
    if (key === 'finish') {
      confirm(
        t('session.finishConfirm.title'),
        t('session.finishConfirm.body'),
        t('session.finishConfirm.action'),
        false,
        () => {
          // La celebración se dispara ANTES de irse: vive en el host raíz (ui/Celebration), así que
          // sobrevive al `router.back()` de dos líneas más abajo.
          haptic('finish')
          celebration.show({
            // Récords, no series: una serie que rompe peso + e1rm cuenta dos. Son los que se
            // rompieron con esta pantalla abierta (`prKinds` no sobrevive a salir y volver), y por
            // eso el badge se esconde en 0 en vez de decir "0 récords".
            prs: [...prKinds.values()].reduce((n, kinds) => n + kinds.length, 0),
            subtitle: t('celebration.subtitle'),
            title: t('celebration.title'),
          })
          endSession(sessionId)
          cancelRestEnd().catch(() => {})
          dismissSessionNotification().catch(() => {})
          router.back()
        },
      )
      return
    }
    // Terminada, "descartar" es "borrar del historial": otro texto para otra consecuencia.
    const ended = live.current.tree?.session.endedAt !== null
    confirm(
      t(ended ? 'session.deleteConfirm.title' : 'session.discardConfirm.title'),
      t(ended ? 'session.deleteConfirm.body' : 'session.discardConfirm.body'),
      t(ended ? 'session.deleteConfirm.action' : 'session.discardConfirm.action'),
      true,
      () => {
        haptic('delete')
        deleteSession(sessionId)
        cancelRestEnd().catch(() => {})
        dismissSessionNotification().catch(() => {})
        router.back()
      },
    )
  }

  const headerItems: MenuItem[] = active
    ? [
        { key: 'finish', label: t('session.finish'), md: 'check', sf: 'checkmark.circle' },
        {
          key: paused ? 'resume' : 'pause',
          label: t(paused ? 'session.resume' : 'session.pause'),
          md: paused ? 'play_arrow' : 'pause',
          sf: paused ? 'play.circle' : 'pause.circle',
        },
        { key: 'edit', label: t('sessionEdit.title'), md: 'edit', skipTick: true, sf: 'pencil' },
        { key: 'share', label: t('session.menu.share'), md: 'share', sf: 'square.and.arrow.up' },
        {
          destructive: true,
          key: 'discard',
          label: t('session.discard'),
          md: 'delete',
          sf: 'trash',
        },
      ]
    : [
        // Terminado, compartir es lo primero que se hace con el entrenamiento.
        { key: 'share', label: t('session.menu.share'), md: 'share', sf: 'square.and.arrow.up' },
        { key: 'edit', label: t('sessionEdit.title'), md: 'edit', skipTick: true, sf: 'pencil' },
        { destructive: true, key: 'discard', label: t('common.delete'), md: 'delete', sf: 'trash' },
      ]

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Menu items={headerItems} onSelect={handleHeaderMenu}>
              <IconButton
                asMenuTrigger
                fallback="⋯"
                label={t('common.more')}
                md="more_horiz"
                sf="ellipsis.circle"
                tint="tint"
              />
            </Menu>
          ),
          title: row.name ?? t('session.untitled'),
        }}
      />
      <Animated.ScrollView
        // El colchón de abajo es la suma de lo que hay apilado ahí (timer + numpad). Con los dos
        // puestos sobra el safe area del timer, que queda tapado por el numpad: sobrar no molesta.
        contentContainerStyle={[
          styles.content,
          { paddingBottom: spacing[6] + (open ? padHeight : 0) + restHeight },
        ]}
        contentInsetAdjustmentBehavior="automatic"
        onScrollBeginDrag={commit}
        ref={scrollRef}
        // Sin esto RN manda el scroll una sola vez por gesto y `offset` se queda viejo justo
        // cuando enfocás una celda después de scrollear (el handler de useScrollViewOffset es un
        // worklet: no cuesta un render).
        scrollEventThrottle={16}
      >
        <SessionElapsed
          endedAt={row.endedAt}
          pausedAt={row.pausedAt}
          pausedMs={row.pausedMs}
          startedAt={row.startedAt}
        />
        {deload ? (
          <View style={styles.deload}>
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.deloadWash]} />
            <Badge label={t('day.deload')} size="md" tone="warning" />
            <Text color="secondary" role="footnote">
              {t('day.deloadHint')}
            </Text>
          </View>
        ) : null}
        {tree.exercises.length === 0 ? (
          <View style={styles.empty}>
            <EmptyState
              md="fitness_center"
              sf="figure.strengthtraining.traditional"
              title={t('session.emptyHint')}
            />
          </View>
        ) : (
          <Sortable
            data={tree.exercises}
            // Con el numpad arriba no se reordena: el dedo está tipeando, no arrastrando.
            enabled={!open}
            keyExtractor={keyOfExercise}
            onReorder={(keys) => reorderExercises(sessionId, keys.map(Number))}
            renderItem={(item, _index, a11y) => {
              // Solo la card enfocada ve cambiar el draft: las demás reciben siempre las mismas
              // props y el compilador les devuelve el árbol cacheado, sin re-renderizar sus filas.
              const here = open && pad !== null && item.sets.some((s) => s.id === pad.setId)
              return (
                // La card entra con FadeIn al agregarla (§7.6); el hueco entre cards vive acá adentro.
                <Animated.View entering={fadeIn(item.se.id)} style={styles.cardSlot}>
                  <ExerciseCard
                    a11y={a11y}
                    draft={here ? draft : ''}
                    focus={here ? pad : null}
                    ghosts={ghosts.get(item.se.id) ?? []}
                    item={item}
                    onComplete={handleComplete}
                    onDeleteSet={handleDeleteSet}
                    onFocus={focusOn}
                    onMenu={handleExerciseMenu}
                    onSetMenu={handleSetMenu}
                    prKinds={prKinds}
                    resumeKey={resumeKey}
                    settings={settings}
                  />
                </Animated.View>
              )
            }}
            scrollableRef={scrollRef}
          />
        )}
        <Button
          md="add"
          onPress={() => router.push({ params: { sessionId }, pathname: '/pick-exercise' })}
          sf="plus"
          title={t('session.addExercise')}
          variant="tinted"
        />
      </Animated.ScrollView>
      {/* La pila de abajo: [timer][numpad]. El timer va primero para que el numpad lo dibuje encima
          (se pisan justo el safe area) y `box-none` para no robarle taps a la lista cuando no hay
          descanso. Se mide siempre: el colchón del scroll es su alto. */}
      <Animated.View
        onLayout={(e) => setRestHeight(e.nativeEvent.layout.height)}
        pointerEvents="box-none"
        style={[styles.rest, restStyle]}
      >
        {restRunning ? (
          <RestTimer
            endsAt={restEndsAt}
            onAdjust={adjustRest}
            onDone={endRest}
            onSkip={endRest}
            startedAt={restStartedAt ?? row.startedAt}
          />
        ) : null}
      </Animated.View>
      <Animated.View
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
        onLayout={(e) => setPadHeight(e.nativeEvent.layout.height)}
        pointerEvents={open ? 'auto' : 'none'}
        style={[styles.pad, padStyle]}
      >
        <NumPad
          field={pad?.field ?? 'weight'}
          incrementLabel={padLabel}
          isLast={nextFocusOf(tree, pad) === null}
          onKey={handleKey}
          unit={settings.unit}
        />
      </Animated.View>
    </View>
  )
}

const keyOfExercise = (item: SessionTree['exercises'][number]) => String(item.se.id)

type ElapsedProps = {
  startedAt: number
  pausedMs: number
  pausedAt: number | null
  endedAt: number | null
}

/**
 * El cronómetro de la sesión, derivado del reloj (nunca acumula tics). Componente aparte para que el
 * tic de 1 Hz re-renderice esta fila y no la pantalla entera con sus cards.
 * Terminada, el reloj para en `ended_at`; en pausa para solo (el tic ni siquiera corre).
 */
function SessionElapsed({ startedAt, pausedMs, pausedAt, endedAt }: ElapsedProps) {
  const focused = useIsFocused()
  const now = useNow(startedAt + pausedMs, focused && pausedAt === null && endedAt === null)
  const time = formatDuration(elapsedMs(startedAt, pausedMs, pausedAt, endedAt ?? now))

  return (
    <View style={styles.elapsed}>
      {/* Sin live region: a 1 Hz el lector de pantalla no dejaría oír nada más. */}
      <Text
        accessibilityLabel={t('session.elapsed', { time })}
        color="secondary"
        role="footnote"
        tabular
      >
        {time}
      </Text>
      {pausedAt === null ? null : <Badge label={t('session.paused')} />}
    </View>
  )
}

type CardProps = {
  item: SessionTree['exercises'][number]
  ghosts: Row[]
  settings: Settings
  focus: Focus | null
  draft: string
  onFocus: (setId: number, field: Field, pageY: number) => void
  onComplete: (setId: number, pageY: number) => void
  onSetMenu: (setId: number) => void
  onDeleteSet: (setId: number) => void
  onMenu: (seId: number, key: string) => void
  /** Los récords de esta pantalla, por serie: la fila solo lee el suyo (ver la pantalla). */
  prKinds: ReadonlyMap<number, PrKind[]>
  /** Solo viaja hasta el efecto de SetRow, que re-apunta sus shared values al volver del background. */
  resumeKey: number
  /** Reordenar sin arrastre: van en el botón de la card, que es lo único enfocable del encabezado. */
  a11y: ReorderActions
}

function ExerciseCard({
  item,
  ghosts,
  settings,
  focus,
  draft,
  onFocus,
  onComplete,
  onSetMenu,
  onDeleteSet,
  onMenu,
  prKinds,
  resumeKey,
  a11y,
}: CardProps) {
  const { se, exercise, sets } = item
  const name = exerciseName(exercise, locale)
  // Las filas que ya estaban al montar la card no animan: un día de rutina precarga sus series y
  // abrir el entrenamiento serían 20 fades a la vez. La que agregás y la que vuelve con Deshacer, sí.
  const fadeIn = useEnterFade(sets.map((s) => s.id))
  const fields = fieldsFor(exercise.metric)
  const extra = settings.rpeMode === 'none' ? null : settings.rpeMode

  // El peso sugerido no siempre está en la primera fila: un día de rutina precarga las entradas en
  // calor sin sugerencia. 'none' y 'repeat' no se explican — el fantasma de la celda ya dice todo.
  const reason = se.suggestedReason
  const suggestedG = sets.find((s) => s.suggestedWeightG !== null)?.suggestedWeightG ?? null
  const suggestion =
    suggestedG !== null && reason !== null && reason !== 'none' && reason !== 'repeat'
      ? `${t('progression.suggested', {
          weight: formatWeight(suggestedG, settings.unit, locale),
        })} · ${t(`progression.reason.${reason}`)}`
      : null
  // Preguntar cómo salió recién cuando no queda nada por hacer en el ejercicio, y una sola vez: la
  // hoja nunca se abre sola (§7.5), y con una respuesta guardada el pie desaparece.
  const askFeedback =
    se.feedback === null && sets.length > 0 && sets.every((s) => s.completedAt !== null)
  const ctaFade = useEnterFade(askFeedback ? [se.id] : [])

  // Las series se numeran sin contar los calentamientos ("W, W, 1", no "W, W, 3"); los
  // calentamientos se numeran entre ellos, solo para el lector.
  const ordinals = ordinalsOf(sets)

  return (
    <Card style={styles.card} variant="raised">
      <View style={styles.cardHeader}>
        <View style={styles.cardTitle}>
          <PressableScale
            accessibilityLabel={name}
            onPress={() => router.push({ params: { id: exercise.id }, pathname: '/exercise/[id]' })}
            scale={0.98}
          >
            <Text color="tint" numberOfLines={2} role="headline">
              {name}
            </Text>
          </PressableScale>
        </View>
        {/* A mano y no `ui/IconButton`: las acciones de reordenar (`a11y`) tienen que ir en el
            elemento accesible, y el trigger del IconButton no reenvía props. */}
        <Menu items={EXERCISE_MENU} onSelect={(key) => onMenu(se.id, key)}>
          <View
            {...a11y}
            accessible
            accessibilityLabel={`${t('common.more')}, ${name}`}
            accessibilityRole="button"
            style={styles.more}
          >
            <SymbolView
              fallback={
                <Text color="tint" role="title">
                  ⋯
                </Text>
              }
              name={{ ios: 'ellipsis.circle' as SFSymbol, android: 'more_horiz' as AndroidSymbol }}
              size={22}
              tintColor={colors.tint}
            />
          </View>
        </Menu>
      </View>
      {suggestion ? (
        <Text color="tertiary" role="footnote" tabular>
          {suggestion}
        </Text>
      ) : null}
      {se.note ? (
        <Text color="secondary" role="footnote" style={styles.note}>
          {se.note}
        </Text>
      ) : null}
      <View style={styles.columns}>
        <Text color="secondary" role="overline" style={styles.colBadge}>
          #
        </Text>
        <Text color="secondary" numberOfLines={1} role="overline" style={styles.colPrev}>
          {t('session.prevLabel')}
        </Text>
        {fields.map((f) => (
          <Text color="secondary" key={f} numberOfLines={1} role="overline" style={styles.colField}>
            {fieldLabel(f, settings.unit)}
          </Text>
        ))}
        {extra ? (
          <Text color="secondary" numberOfLines={1} role="overline" style={styles.colField}>
            {fieldLabel(extra, settings.unit)}
          </Text>
        ) : null}
        <View style={styles.colCheck} />
      </View>
      {/* El hueco que deja una fila borrada lo cierra RowLayout — es la única región de la card
          con layout animation, y las filas no se arrastran (lo que se arrastra es la card). */}
      {sets.map((set, index) => (
        // `entering` para que una serie restaurada (deshacer) o recién agregada no aparezca de la
        // nada mientras las de abajo bajan con RowLayout (§7.1).
        <Animated.View entering={fadeIn(set.id)} key={set.id} layout={RowLayout}>
          <SwipeRow onDelete={() => onDeleteSet(set.id)}>
            <SetRow
              draft={focus?.setId === set.id ? draft : ''}
              fields={fields}
              focused={focus?.setId === set.id ? focus.field : null}
              index={ordinals[index]}
              locale={locale}
              onComplete={(pageY) => onComplete(set.id, pageY)}
              onFocus={(f, pageY) => onFocus(set.id, f, pageY)}
              onKindPress={() => onSetMenu(set.id)}
              prKinds={prKinds.get(set.id) ?? NO_KINDS}
              prev={ghostFor(sets, index, ghosts)}
              resumeKey={resumeKey}
              set={set}
              showRpe={settings.rpeMode}
              unit={settings.unit}
            />
          </SwipeRow>
        </Animated.View>
      ))}
      <PressableScale
        // Con el nombre: el entrenamiento tiene una de estas por ejercicio y en el rotor todas
        // dirían "Agregar serie".
        accessibilityLabel={`${t('session.addSet')}, ${name}`}
        onPress={() => addSet(se.id)}
        scale={0.98}
        style={styles.addSet}
      >
        <Text color="tint" role="callout">
          {t('session.addSet')}
        </Text>
      </PressableScale>
      {askFeedback ? (
        // Igual que las filas: el pie del ejercicio que ya estaba terminado al abrir no anima —
        // solo el que se termina con la pantalla abierta.
        <Animated.View entering={ctaFade(se.id)}>
          <PressableScale
            accessibilityLabel={`${t('feedback.cta')}, ${name}`}
            accessibilityRole="button"
            onPress={() => router.push({ params: { seId: se.id }, pathname: '/feedback' })}
            scale={0.98}
            style={styles.feedbackCta}
          >
            <Text color="secondary" role="footnote">
              {t('feedback.cta')}
            </Text>
          </PressableScale>
        </Animated.View>
      ) : null}
    </Card>
  )
}

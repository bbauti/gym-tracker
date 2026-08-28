import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNotNull,
  isNull,
  sql,
} from 'drizzle-orm'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import { t } from '@/i18n'
import type { Suggestion } from '@/lib/progression'
import type { DraftExercise, RoutineDraft } from '@/lib/routineText'
import type { Unit } from '@/lib/units'
import { db } from '../client'
import {
  exercise,
  routine,
  routineDay,
  routineExercise,
  routineSet,
  type SetKind,
  session,
  sessionExercise,
  setEntry,
} from '../schema'
import { type Exercise, normalizeName } from './exercises'
import { suggestFor } from './progression'

export type RoutineRow = typeof routine.$inferSelect
export type RoutineDayRow = typeof routineDay.$inferSelect
export type RoutineExerciseRow = typeof routineExercise.$inferSelect
export type RoutineSetRow = typeof routineSet.$inferSelect

/**
 * El árbol entero de la pantalla de rutina. Los días vienen en el orden canónico (semana, después
 * posición dentro de la semana), así que agruparlos por semana es recorrer la lista una vez.
 */
export type RoutineTree = {
  routine: RoutineRow
  days: Array<{
    day: RoutineDayRow
    exercises: Array<{ re: RoutineExerciseRow; exercise: Exercise; sets: RoutineSetRow[] }>
  }>
}

/** Una fila de la lista de rutinas: lo justo para la card, sin traer el árbol. */
export type RoutineSummary = {
  routine: RoutineRow
  dayCount: number
  /** El día que toca (rotación D10). `null` solo si la rutina se quedó sin días. */
  nextDay: (RoutineDayRow & { exerciseCount: number; setCount: number }) | null
  lastDoneAt: number | null
  /** Duración estimada del `nextDay` (D12), o `null` si nunca se entrenó ese día. */
  estimatedMs: number | null
}

/**
 * expo-sqlite en la app, bun:sqlite en los tests y una transacción de drizzle (que extiende la misma
 * clase): los tres son el mismo driver síncrono y solo difieren en el tipo que devuelve `.run()`.
 */
// biome-ignore lint/suspicious/noExplicitAny: los parámetros del driver, que son justo lo que varía
type Db = BaseSQLiteDatabase<'sync', any, any, any>

/** Series por defecto de un ejercicio recién agregado a un día: 3 × 8–12. */
const DEFAULT_SETS = 3
const DEFAULT_REPS_MIN = 8
const DEFAULT_REPS_MAX = 12

/** Cuántas sesiones terminadas promedia la estimación de duración (D12). */
const ESTIMATE_SAMPLE = 5
/** Menos de un minuto no fue un entrenamiento: fue abrir y cerrar. No entra en el promedio. */
const ESTIMATE_MIN_MS = 60_000

// SQL a mano y no `${tabla.columna}`: en el select de una query de una sola tabla drizzle tira el
// prefijo de tabla, y una subquery correlacionada resolvería ese `"id"` pelado contra su propio FROM.
const DAY_EXERCISE_COUNT = sql<number>`(
  select count(*) from "routine_exercise"
  where "routine_exercise"."day_id" = "routine_day"."id"
)`
const DAY_SET_COUNT = sql<number>`(
  select count(*) from "routine_set"
  join "routine_exercise" on "routine_exercise"."id" = "routine_set"."routine_exercise_id"
  where "routine_exercise"."day_id" = "routine_day"."id"
)`

/**
 * D05. El orden canónico de los días: primero la semana, después la posición dentro de ella. Un ASC
 * de SQLite pone los NULL adelante, que es justo lo que hace falta — una rutina de una sola semana
 * deja `week_index` en null y sus días van antes que los de cualquier semana numerada.
 *
 * La rotación (D10) camina este orden, así que un programa de dos semanas cicla
 * S1D1 → S1D2 → S2D1 → S2D2 → S1D1.
 */
const DAY_ORDER = [asc(routineDay.weekIndex), asc(routineDay.orderIndex), asc(routineDay.id)]

/** El índice guardado puede haber quedado fuera de rango (se borró un día): siempre da una posición. */
function wrap(index: number, count: number): number {
  if (count <= 0) return 0
  return ((index % count) + count) % count
}

export function listRoutines(): RoutineSummary[] {
  const routines = db
    .select()
    .from(routine)
    .where(isNull(routine.archivedAt))
    .orderBy(asc(routine.name), asc(routine.id))
    .all()
  if (routines.length === 0) return []

  const ids = routines.map((r) => r.id)
  const days = db
    .select({
      ...getTableColumns(routineDay),
      exerciseCount: DAY_EXERCISE_COUNT,
      setCount: DAY_SET_COUNT,
    })
    .from(routineDay)
    .where(inArray(routineDay.routineId, ids))
    .orderBy(asc(routineDay.routineId), ...DAY_ORDER)
    .all()

  const lastDone = db
    .select({ routineId: routineDay.routineId, at: sql<number | null>`max(${session.endedAt})` })
    .from(session)
    .innerJoin(routineDay, eq(routineDay.id, session.routineDayId))
    .where(and(inArray(routineDay.routineId, ids), isNotNull(session.endedAt)))
    .groupBy(routineDay.routineId)
    .all()

  const byRoutine = new Map<number, (typeof days)[number][]>()
  for (const d of days) {
    const list = byRoutine.get(d.routineId)
    if (list) list.push(d)
    else byRoutine.set(d.routineId, [d])
  }
  const doneAt = new Map(lastDone.map((r) => [r.routineId, r.at]))

  // ponytail: la estimación es una query por rutina (no una sola con GROUP BY). Techo: 20 rutinas =
  // 20 queries indexadas en una pantalla que se abre a mano. Upgrade: una CTE con row_number().
  return routines.map((r) => {
    const list = byRoutine.get(r.id) ?? []
    const nextDay = list.length === 0 ? null : list[wrap(r.currentDayIndex, list.length)]
    return {
      routine: r,
      dayCount: list.length,
      nextDay,
      lastDoneAt: doneAt.get(r.id) ?? null,
      estimatedMs: nextDay ? estimatedDurationMs(nextDay.id) : null,
    }
  })
}

/** Cuatro round trips (rutina · días · ejercicios · series), nunca uno por fila. */
export function getRoutineTree(id: number): RoutineTree | null {
  const row = db.select().from(routine).where(eq(routine.id, id)).get()
  if (!row) return null

  const days = db
    .select()
    .from(routineDay)
    .where(eq(routineDay.routineId, id))
    .orderBy(...DAY_ORDER)
    .all()

  const dayIds = days.map((d) => d.id)
  const rows =
    dayIds.length === 0
      ? []
      : db
          .select()
          .from(routineExercise)
          .innerJoin(exercise, eq(exercise.id, routineExercise.exerciseId))
          .where(inArray(routineExercise.dayId, dayIds))
          .orderBy(asc(routineExercise.orderIndex), asc(routineExercise.id))
          .all()

  const reIds = rows.map((r) => r.routine_exercise.id)
  const sets =
    reIds.length === 0
      ? []
      : db
          .select()
          .from(routineSet)
          .where(inArray(routineSet.routineExerciseId, reIds))
          .orderBy(asc(routineSet.orderIndex), asc(routineSet.id))
          .all()

  const byRe = new Map<number, RoutineSetRow[]>()
  for (const s of sets) {
    const list = byRe.get(s.routineExerciseId)
    if (list) list.push(s)
    else byRe.set(s.routineExerciseId, [s])
  }

  const byDay = new Map<number, RoutineTree['days'][number]['exercises']>()
  for (const r of rows) {
    const entry = {
      re: r.routine_exercise,
      exercise: r.exercise,
      sets: byRe.get(r.routine_exercise.id) ?? [],
    }
    const list = byDay.get(r.routine_exercise.dayId)
    if (list) list.push(entry)
    else byDay.set(r.routine_exercise.dayId, [entry])
  }

  return { routine: row, days: days.map((day) => ({ day, exercises: byDay.get(day.id) ?? [] })) }
}

/** La hoja de renombrar solo necesita el nombre: pedir el árbol entero para eso son 3 queries de más. */
export function getRoutine(id: number): RoutineRow | null {
  return db.select().from(routine).where(eq(routine.id, id)).get() ?? null
}

/**
 * La pantalla del día llega con el id del día y nada más: sin esto no sabe de qué rutina es (y el
 * árbol se pide por rutina). Lectura pura — nada acá escribe en `routine*`.
 */
export function getRoutineDay(id: number): RoutineDayRow | null {
  return db.select().from(routineDay).where(eq(routineDay.id, id)).get() ?? null
}

/** Ídem para la hoja de serie objetivo, que abre con el id de la serie. */
export function getRoutineSet(id: number): RoutineSetRow | null {
  return db.select().from(routineSet).where(eq(routineSet.id, id)).get() ?? null
}

/** Una rutina sin días no se puede empezar: nace con el primero. */
export function createRoutine(name: string, firstDayName: string): number {
  return db.transaction((tx) => {
    const id = tx.insert(routine).values({ name }).returning({ id: routine.id }).get().id
    tx.insert(routineDay).values({ routineId: id, name: firstDayName, orderIndex: 0 }).run()
    return id
  })
}

export function updateRoutine(id: number, patch: { name?: string }): void {
  if (Object.keys(patch).length === 0) return
  db.update(routine).set(patch).where(eq(routine.id, id)).run()
}

/**
 * Días, ejercicios y series se van con ella (FK cascade). Las sesiones que salieron de esta rutina
 * NO: `session.routine_day_id` es `set null` y el historial es del usuario, no de la rutina.
 */
export function deleteRoutine(id: number): void {
  db.delete(routine).where(eq(routine.id, id)).run()
}

/**
 * Copia profunda en una transacción. La copia arranca la rotación de cero: duplicar es para editar
 * una variante, no para seguir donde iba la original.
 */
export function duplicateRoutine(id: number, newName: string): number {
  return db.transaction((tx) => {
    const src = tx.select().from(routine).where(eq(routine.id, id)).get()
    if (!src) throw new Error(`routine ${id} not found`)

    const copyId = tx
      .insert(routine)
      .values({ name: newName, folderId: src.folderId, weeks: src.weeks, currentDayIndex: 0 })
      .returning({ id: routine.id })
      .get().id

    const days = tx
      .select()
      .from(routineDay)
      .where(eq(routineDay.routineId, id))
      .orderBy(...DAY_ORDER)
      .all()

    // ponytail: N+1 adentro de la transacción (un insert por ejercicio, para saber su id nuevo).
    // Techo: una rutina de 6 días × 8 ejercicios son ~60 statements, milisegundos. Upgrade:
    // INSERT … SELECT con una tabla de mapeo de ids si alguna vez importás rutinas gigantes.
    for (const d of days) {
      const dayId = tx
        .insert(routineDay)
        .values({
          routineId: copyId,
          name: d.name,
          orderIndex: d.orderIndex,
          weekIndex: d.weekIndex,
          isDeload: d.isDeload,
        })
        .returning({ id: routineDay.id })
        .get().id

      const exercises = tx
        .select()
        .from(routineExercise)
        .where(eq(routineExercise.dayId, d.id))
        .orderBy(asc(routineExercise.orderIndex), asc(routineExercise.id))
        .all()

      for (const re of exercises) {
        const reId = tx
          .insert(routineExercise)
          .values({
            dayId,
            exerciseId: re.exerciseId,
            orderIndex: re.orderIndex,
            supersetGroup: re.supersetGroup,
            restSec: re.restSec,
            warmupRestSec: re.warmupRestSec,
          })
          .returning({ id: routineExercise.id })
          .get().id

        const sets = tx
          .select()
          .from(routineSet)
          .where(eq(routineSet.routineExerciseId, re.id))
          .orderBy(asc(routineSet.orderIndex), asc(routineSet.id))
          .all()

        if (sets.length > 0) {
          tx.insert(routineSet)
            .values(
              sets.map((s) => ({
                routineExerciseId: reId,
                orderIndex: s.orderIndex,
                kind: s.kind,
                repsMin: s.repsMin,
                repsMax: s.repsMax,
                targetRpe: s.targetRpe,
              })),
            )
            .run()
        }
      }
    }
    return copyId
  })
}

export type RoutineExportSet = Pick<RoutineSetRow, 'kind' | 'repsMin' | 'repsMax' | 'targetRpe'>

export type RoutineExportExercise = {
  seedId: string | null
  nameEs: string
  nameEn: string
  restSec: number | null
  supersetGroup: number | null
  sets: RoutineExportSet[]
}

export type RoutineExportDay = {
  name: string
  weekIndex: number | null
  isDeload: boolean
  exercises: RoutineExportExercise[]
}

/**
 * N02. Lo que sale al compartir una rutina, y lo único que `parseRoutineDraft` puede leer entero.
 * El ejercicio viaja con su `seedId` y con los dos nombres: quien la reciba puede tener la app en
 * el otro idioma, o no tener ese ejercicio propio.
 */
export type RoutineExport = {
  format: 'gym-tracker-routine'
  version: 1
  name: string
  weeks: number | null
  days: RoutineExportDay[]
}

export function exportRoutine(id: number): RoutineExport | null {
  const tree = getRoutineTree(id)
  if (!tree) return null
  return {
    format: 'gym-tracker-routine',
    version: 1,
    name: tree.routine.name,
    weeks: tree.routine.weeks,
    days: tree.days.map(({ day, exercises }) => ({
      name: day.name,
      weekIndex: day.weekIndex,
      isDeload: day.isDeload,
      exercises: exercises.map(({ re, exercise: e, sets }) => ({
        seedId: e.seedId,
        nameEs: e.nameEs,
        nameEn: e.nameEn,
        restSec: re.restSec,
        supersetGroup: re.supersetGroup,
        sets: sets.map((s) => ({
          kind: s.kind,
          repsMin: s.repsMin,
          repsMax: s.repsMax,
          targetRpe: s.targetRpe,
        })),
      })),
    })),
  }
}

export type ImportResult = { routineId: number; created: string[] }

/** Un archivo que pide más series que esto para un ejercicio está mal, no es ambicioso. */
const MAX_IMPORT_SETS = 20

/** D05. Ocho semanas ya es un bloque entero; más que eso no se planifica, se improvisa. */
export const MAX_WEEKS = 8

/**
 * D08. El borrador entra en una sola transacción: o queda la rutina entera o no queda nada.
 *
 * El ejercicio se reconoce por `seedId` primero y por nombre exacto después (sin acentos ni
 * mayúsculas, contra es, en y alias). Lo que no está en el catálogo se crea como ejercicio propio y
 * se devuelve en `created`, que es lo que la pantalla cuenta al terminar.
 *
 * `unit` está en la firma porque el texto puede traer pesos sin unidad ("Squat 5×5 @100"), pero
 * ninguno llega a la base: `routine_set` guarda rango de repeticiones y RPE, no peso — el peso lo
 * sugiere el historial (§2.2). Queda en el borrador, para el preview de la pantalla.
 */
export function importRoutine(draft: RoutineDraft, _opts: { unit: Unit }): ImportResult {
  return db.transaction((tx) => {
    // Con tope: una columna `week` con un año adentro pedía 2026 semanas, y la pantalla las dibuja
    // todas. Los días que sobran se re-acomodan solos en el clamp de `weekIndex` de más abajo.
    const weeks = draft.weeks !== null && draft.weeks > 1 ? Math.min(draft.weeks, MAX_WEEKS) : null
    const routineId = tx
      .insert(routine)
      .values({ name: draft.name?.trim() || t('routine.new'), weeks })
      .returning({ id: routine.id })
      .get().id

    // ponytail: el catálogo entero en memoria para resolver nombres (unos cientos de filas, una sola
    // query). Techo: un archivo con 500 ejercicios lo recorre igual. Upgrade: matchear en SQL.
    const bySeed = new Map<string, number>()
    const byName = new Map<string, number>()
    const catalogue = tx
      .select({
        id: exercise.id,
        seedId: exercise.seedId,
        nameEs: exercise.nameEs,
        nameEn: exercise.nameEn,
        aliases: exercise.aliases,
      })
      .from(exercise)
      .all()
    for (const e of catalogue) {
      if (e.seedId) bySeed.set(e.seedId, e.id)
      for (const name of [e.nameEs, e.nameEn, ...(e.aliases ?? [])]) {
        const key = normalizeName(name)
        if (key && !byName.has(key)) byName.set(key, e.id)
      }
    }

    const created: string[] = []
    const resolve = (ex: DraftExercise): number => {
      const seeded = ex.seedId ? bySeed.get(ex.seedId) : undefined
      if (seeded !== undefined) return seeded
      const key = normalizeName(ex.name)
      const known = byName.get(key)
      if (known !== undefined) return known

      // Mismo nombre en los dos idiomas: no hay de dónde sacar la traducción, y una columna vacía
      // deja al ejercicio fuera del buscador en la mitad de los teléfonos.
      const id = tx
        .insert(exercise)
        .values({
          nameEs: ex.name,
          nameEn: ex.name,
          primaryMuscle: 'full_body',
          equipment: 'other',
          metric: 'weight_reps',
          isCustom: true,
        })
        .returning({ id: exercise.id })
        .get().id
      byName.set(key, id)
      created.push(ex.name)
      return id
    }

    // Cada semana numera sus días desde cero, igual que `addDay`.
    const counts = new Map<number | null, number>()
    for (const day of draft.days) {
      const weekIndex = weeks === null ? null : Math.min(Math.max(0, day.weekIndex ?? 0), weeks - 1)
      const orderIndex = counts.get(weekIndex) ?? 0
      counts.set(weekIndex, orderIndex + 1)

      const dayId = tx
        .insert(routineDay)
        .values({
          routineId,
          name: day.name.trim() || t('routine.dayDefault', { n: orderIndex + 1 }),
          orderIndex,
          weekIndex,
          isDeload: day.isDeload ?? false,
        })
        .returning({ id: routineDay.id })
        .get().id

      day.exercises.forEach((ex, index) => {
        const reId = tx
          .insert(routineExercise)
          .values({
            dayId,
            exerciseId: resolve(ex),
            orderIndex: index,
            restSec: ex.restSec ?? null,
            supersetGroup: ex.supersetGroup ?? null,
          })
          .returning({ id: routineExercise.id })
          .get().id

        // El JSON de la app trae las series de verdad (tipo, rango y RPE de cada una); el texto y el
        // CSV solo saben cuántas son, y ahí sí salen todas iguales.
        const count = Math.min(MAX_IMPORT_SETS, Math.max(1, Math.round(ex.sets) || 1))
        const rows = ex.setRows?.length
          ? ex.setRows.slice(0, MAX_IMPORT_SETS).map((s, i) => ({
              routineExerciseId: reId,
              orderIndex: i,
              kind: s.kind,
              repsMin: s.repsMin,
              repsMax: s.repsMax,
              targetRpe: s.targetRpe,
            }))
          : Array.from({ length: count }, (_, i) => ({
              routineExerciseId: reId,
              orderIndex: i,
              kind: 'normal' as SetKind,
              repsMin: ex.repsMin,
              repsMax: ex.repsMax ?? ex.repsMin,
              targetRpe: null,
            }))
        tx.insert(routineSet).values(rows).run()
      })
    }

    return { routineId, created }
  })
}

/** `orderIndex` se cuenta DENTRO de la semana: cada semana numera sus días desde cero. */
export function addDay(routineId: number, name: string, weekIndex: number | null = null): number {
  return db.transaction((tx) => {
    const next = tx
      .select({ n: sql<number>`coalesce(max(${routineDay.orderIndex}) + 1, 0)` })
      .from(routineDay)
      .where(
        and(
          eq(routineDay.routineId, routineId),
          weekIndex === null ? isNull(routineDay.weekIndex) : eq(routineDay.weekIndex, weekIndex),
        ),
      )
      .get()

    return tx
      .insert(routineDay)
      .values({ routineId, name, orderIndex: next?.n ?? 0, weekIndex })
      .returning({ id: routineDay.id })
      .get().id
  })
}

/**
 * D05. Un programa de varias semanas. `weeks` en 1 (o null) vuelve a la rutina de una sola semana y
 * deja los días con `week_index` en null, que es como el schema dice "sin semanas".
 *
 * Bajar de 4 semanas a 2 NO borra nada: los días de las que se van se mudan al final de la última
 * que queda. Perder tres días de trabajo por tocar un stepper de más sería imperdonable.
 */
export function setWeeks(routineId: number, weeks: number | null): void {
  db.transaction((tx) => {
    const row = tx.select().from(routine).where(eq(routine.id, routineId)).get()
    if (!row) return
    const total = weeks !== null && weeks > 1 ? weeks : null

    const days = tx
      .select()
      .from(routineDay)
      .where(eq(routineDay.routineId, routineId))
      .orderBy(...DAY_ORDER)
      .all()

    // Recorrer en el orden canónico y renumerar deja la secuencia igual que estaba: la rotación
    // sigue apuntando al mismo día sin tocar `current_day_index`.
    const counts = new Map<number | null, number>()
    for (const day of days) {
      const weekIndex = total === null ? null : Math.min(day.weekIndex ?? 0, total - 1)
      const orderIndex = counts.get(weekIndex) ?? 0
      counts.set(weekIndex, orderIndex + 1)
      if (weekIndex !== day.weekIndex || orderIndex !== day.orderIndex) {
        tx.update(routineDay).set({ orderIndex, weekIndex }).where(eq(routineDay.id, day.id)).run()
      }
    }

    tx.update(routine).set({ weeks: total }).where(eq(routine.id, routineId)).run()
  })
}

/** D02. `null` la saca de la carpeta y la deja suelta; la carpeta no se toca. */
export function moveRoutineToFolder(routineId: number, folderId: number | null): void {
  db.update(routine).set({ folderId }).where(eq(routine.id, routineId)).run()
}

export function updateDay(id: number, patch: { name?: string; isDeload?: boolean }): void {
  if (Object.keys(patch).length === 0) return
  db.update(routineDay).set(patch).where(eq(routineDay.id, id)).run()
}

/**
 * `current_day_index` es una POSICIÓN, así que borrar un día corre a todos los que estaban detrás:
 * igual que en `reorderDays`, se anota a qué día apuntaba la rotación y se lo vuelve a buscar en la
 * lista que quedó. Borrar el lunes no te saltea el martes.
 *
 * Si el que se borró era justo el que tocaba, el índice se recorta y el siguiente pasa a ser el que
 * toca (y con la rutina sin días, cero: la card dice "Siguiente: —" hasta que agregues uno).
 */
export function deleteDay(id: number): void {
  db.transaction((tx) => {
    const day = tx.select().from(routineDay).where(eq(routineDay.id, id)).get()
    if (!day) return
    const row = tx.select().from(routine).where(eq(routine.id, day.routineId)).get()
    const orderedIds = () =>
      tx
        .select({ id: routineDay.id })
        .from(routineDay)
        .where(eq(routineDay.routineId, day.routineId))
        .orderBy(...DAY_ORDER)
        .all()
        .map((d) => d.id)

    const before = orderedIds()
    const pointedAt =
      row && before.length > 0 ? before[wrap(row.currentDayIndex, before.length)] : null

    tx.delete(routineDay).where(eq(routineDay.id, id)).run()
    if (!row) return

    const left = orderedIds()
    const at = pointedAt === null ? -1 : left.indexOf(pointedAt)
    const next =
      at >= 0 ? at : left.length === 0 ? 0 : Math.min(row.currentDayIndex, left.length - 1)
    if (next !== row.currentDayIndex) {
      tx.update(routine).set({ currentDayIndex: next }).where(eq(routine.id, day.routineId)).run()
    }
  })
}

/**
 * Una transacción, así la lista nunca se dibuja a medio reordenar. Ids de otra rutina se ignoran.
 *
 * `orderedDayIds` es el orden nuevo de UNA semana (cada semana tiene su propio sortable): el
 * `orderIndex` se numera dentro de esa lista y las otras semanas no se tocan.
 *
 * `current_day_index` es una POSICIÓN, así que arrastrar un día cambiaría cuál toca: se anota a qué
 * día apuntaba y se lo vuelve a buscar en el orden que quedó. Reordenar la lista no te saltea un día.
 */
export function reorderDays(routineId: number, orderedDayIds: number[]): void {
  db.transaction((tx) => {
    const row = tx.select().from(routine).where(eq(routine.id, routineId)).get()
    const ordered = () =>
      tx
        .select({ id: routineDay.id })
        .from(routineDay)
        .where(eq(routineDay.routineId, routineId))
        .orderBy(...DAY_ORDER)
        .all()
        .map((d) => d.id)

    const before = ordered()
    const pointedAt =
      row && before.length > 0 ? before[wrap(row.currentDayIndex, before.length)] : null

    orderedDayIds.forEach((dayId, index) => {
      tx.update(routineDay)
        .set({ orderIndex: index })
        .where(and(eq(routineDay.id, dayId), eq(routineDay.routineId, routineId)))
        .run()
    })

    if (!row || pointedAt === null) return
    const at = ordered().indexOf(pointedAt)
    if (at >= 0 && at !== row.currentDayIndex) {
      tx.update(routine).set({ currentDayIndex: at }).where(eq(routine.id, routineId)).run()
    }
  })
}

/** Con sus 3 series de 8–12: un ejercicio sin series no dice nada y obliga a tres taps más. */
export function addRoutineExercise(dayId: number, exerciseId: number): number {
  return db.transaction((tx) => {
    const next = tx
      .select({ n: sql<number>`coalesce(max(${routineExercise.orderIndex}) + 1, 0)` })
      .from(routineExercise)
      .where(eq(routineExercise.dayId, dayId))
      .get()

    const reId = tx
      .insert(routineExercise)
      .values({ dayId, exerciseId, orderIndex: next?.n ?? 0 })
      .returning({ id: routineExercise.id })
      .get().id

    tx.insert(routineSet)
      .values(
        Array.from({ length: DEFAULT_SETS }, (_, i) => ({
          routineExerciseId: reId,
          orderIndex: i,
          kind: 'normal' as const,
          repsMin: DEFAULT_REPS_MIN,
          repsMax: DEFAULT_REPS_MAX,
        })),
      )
      .run()

    return reId
  })
}

export type RoutineExerciseSnapshot = { re: RoutineExerciseRow; sets: RoutineSetRow[] }

/**
 * Sus series se van con él (FK cascade), así que quitar es destructivo y no pregunta nada: lo que
 * devuelve es lo que el toast de deshacer necesita para devolver la fila entera (mismos ids, mismo
 * `orderIndex`) con `restoreRoutineExercise`.
 */
export function removeRoutineExercise(id: number): RoutineExerciseSnapshot | null {
  return db.transaction((tx) => {
    const re = tx.select().from(routineExercise).where(eq(routineExercise.id, id)).get()
    if (!re) return null
    const sets = tx
      .select()
      .from(routineSet)
      .where(eq(routineSet.routineExerciseId, id))
      .orderBy(asc(routineSet.orderIndex), asc(routineSet.id))
      .all()
    tx.delete(routineExercise).where(eq(routineExercise.id, id)).run()
    return { re, sets }
  })
}

/**
 * El toast vive 4 s (12 con lector de pantalla) y sobrevive a navegar: para cuando tocás "Deshacer"
 * el día pudo haberse borrado. Sin el padre el insert reventaría contra la FK, así que deshacer lo
 * que ya no existe no hace nada (y no tira dentro del onPress del toast).
 */
export function restoreRoutineExercise(snapshot: RoutineExerciseSnapshot): void {
  db.transaction((tx) => {
    const day = tx
      .select({ id: routineDay.id })
      .from(routineDay)
      .where(eq(routineDay.id, snapshot.re.dayId))
      .get()
    if (!day) return
    tx.insert(routineExercise).values(snapshot.re).run()
    if (snapshot.sets.length > 0) tx.insert(routineSet).values(snapshot.sets).run()
  })
}

export function reorderRoutineExercises(dayId: number, orderedIds: number[]): void {
  db.transaction((tx) => {
    orderedIds.forEach((id, index) => {
      tx.update(routineExercise)
        .set({ orderIndex: index })
        .where(and(eq(routineExercise.id, id), eq(routineExercise.dayId, dayId)))
        .run()
    })
  })
}

export function updateRoutineExercise(id: number, patch: { restSec?: number | null }): void {
  if (Object.keys(patch).length === 0) return
  db.update(routineExercise).set(patch).where(eq(routineExercise.id, id)).run()
}

/** "Una más igual": la serie nueva copia a la última. Sin última, el 3×8–12 de siempre. */
export function addRoutineSet(reId: number): number {
  return db.transaction((tx) => {
    const prev = tx
      .select()
      .from(routineSet)
      .where(eq(routineSet.routineExerciseId, reId))
      .orderBy(desc(routineSet.orderIndex), desc(routineSet.id))
      .limit(1)
      .get()

    return tx
      .insert(routineSet)
      .values({
        routineExerciseId: reId,
        orderIndex: prev ? prev.orderIndex + 1 : 0,
        kind: prev?.kind ?? 'normal',
        repsMin: prev ? prev.repsMin : DEFAULT_REPS_MIN,
        repsMax: prev ? prev.repsMax : DEFAULT_REPS_MAX,
        targetRpe: prev?.targetRpe ?? null,
      })
      .returning({ id: routineSet.id })
      .get().id
  })
}

export function updateRoutineSet(
  id: number,
  patch: {
    kind?: SetKind
    repsMin?: number | null
    repsMax?: number | null
    targetRpe?: number | null
  },
): void {
  if (Object.keys(patch).length === 0) return
  db.update(routineSet).set(patch).where(eq(routineSet.id, id)).run()
}

/** Devuelve la fila para que el toast de deshacer la ponga de vuelta tal cual estaba. */
export function deleteRoutineSet(id: number): RoutineSetRow {
  const row = db.delete(routineSet).where(eq(routineSet.id, id)).returning().get()
  if (!row) throw new Error(`routine set ${id} not found`)
  return row
}

/** Mismo id y mismo `orderIndex`: deshacer la restaura en su lugar, no al final. Ídem arriba: si el
 * ejercicio se fue mientras el toast estaba en pantalla, no hay dónde devolverla. */
export function restoreRoutineSet(row: RoutineSetRow): void {
  const re = db
    .select({ id: routineExercise.id })
    .from(routineExercise)
    .where(eq(routineExercise.id, row.routineExerciseId))
    .get()
  if (!re) return
  db.insert(routineSet).values(row).run()
}

/**
 * D12. Promedio de las últimas sesiones terminadas de ESTE día, tiempo en pausa descontado (es la
 * misma cuenta que el historial). `null` mientras el día no se haya entrenado nunca: un número
 * inventado a partir de "3 series × 90 s" miente más de lo que ayuda.
 *
 * Las de menos de un minuto (empezar sin querer y terminar) quedan afuera del promedio: una sola
 * alcanzaba para que la card prometiera "~0:00".
 */
export function estimatedDurationMs(dayId: number): number | null {
  const net = sql<number>`${session.endedAt} - ${session.startedAt} - ${session.pausedMs}`
  const rows = db
    .select({ ms: net })
    .from(session)
    .where(
      and(eq(session.routineDayId, dayId), isNotNull(session.endedAt), gt(net, ESTIMATE_MIN_MS)),
    )
    .orderBy(desc(session.endedAt), desc(session.id))
    .limit(ESTIMATE_SAMPLE)
    .all()

  if (rows.length === 0) return null
  // Al minuto: es un promedio de 5 entrenamientos, y "~1:05:23" promete una precisión que no tiene.
  const avg = rows.reduce((sum, r) => sum + r.ms, 0) / rows.length
  return Math.round(avg / 60_000) * 60_000
}

/**
 * D07: el día se pre-carga como filas REALES sin completar, no como una plantilla que se aplica
 * después. Las series entran con su rango objetivo copiado (`target_reps_*`) y el peso sugerido en
 * `suggested_weight_g` (con su porqué en `session_exercise.suggested_reason`), que la pantalla
 * dibuja como ghost — la app sugiere, nunca aplica (§2.2).
 *
 * Mismos shapes de insert que `addExercise`/`addSet` de `session.ts`: la pantalla de sesión no se
 * entera de que esto salió de una rutina.
 */
export function startSessionFromDay(dayId: number): number {
  const now = Date.now()
  return db.transaction((tx) => {
    const day = tx.select().from(routineDay).where(eq(routineDay.id, dayId)).get()
    if (!day) throw new Error(`routine day ${dayId} not found`)

    const sessionId = tx
      .insert(session)
      .values({ name: day.name, routineDayId: dayId, startedAt: now })
      .returning({ id: session.id })
      .get().id

    const exercises = tx
      .select()
      .from(routineExercise)
      .where(eq(routineExercise.dayId, dayId))
      .orderBy(asc(routineExercise.orderIndex), asc(routineExercise.id))
      .all()

    // El mismo ejercicio puede aparecer dos veces en un día (dos bloques): una sola sugerencia.
    const suggested = new Map<number, Suggestion>()

    exercises.forEach((re, index) => {
      const sets = tx
        .select()
        .from(routineSet)
        .where(eq(routineSet.routineExerciseId, re.id))
        .orderBy(asc(routineSet.orderIndex), asc(routineSet.id))
        .all()

      // La sugerencia es una por ejercicio, así que el objetivo que la guía es el de su primera
      // serie de trabajo: la entrada en calor no pide repeticiones ni esfuerzo.
      const target = sets.find((s) => s.kind !== 'warmup')
      let suggestion = suggested.get(re.exerciseId)
      if (!suggestion) {
        suggestion = suggestFor(tx, re.exerciseId, {
          excludeSessionId: sessionId,
          targetRepsMax: target?.repsMax,
          targetRepsMin: target?.repsMin,
          targetRpe: target?.targetRpe,
        })
        suggested.set(re.exerciseId, suggestion)
      }

      const seId = tx
        .insert(sessionExercise)
        .values({
          sessionId,
          exerciseId: re.exerciseId,
          orderIndex: index,
          supersetGroup: re.supersetGroup,
          // El descanso de la rutina viaja con la fila: la pantalla de sesión lo prefiere al del
          // ejercicio y al de ajustes, y editar la rutina mañana no cambia el de este entrenamiento.
          restSec: re.restSec,
          suggestedReason: suggestion.reason,
        })
        .returning({ id: sessionExercise.id })
        .get().id

      const suggestedWeightG = suggestion.weightG
      const suggestedReps = suggestion.reps

      // Un ejercicio al que le borraron todas las series igual necesita una fila donde tipear,
      // igual que el que agregás a mano (`addExercise`).
      tx.insert(setEntry)
        .values(
          sets.length === 0
            ? [
                {
                  sessionExerciseId: seId,
                  orderIndex: 0,
                  kind: 'normal' as const,
                  suggestedWeightG,
                  suggestedReps,
                },
              ]
            : sets.map((s, i) => ({
                sessionExerciseId: seId,
                orderIndex: i,
                kind: s.kind,
                targetRepsMin: s.repsMin,
                targetRepsMax: s.repsMax,
                // La entrada en calor no se sugiere con el peso de trabajo: el fantasma se confirma
                // solo al tildar, y una serie de calentamiento quedaría anotada con los 100 kg.
                suggestedWeightG: s.kind === 'warmup' ? null : suggestedWeightG,
                suggestedReps: s.kind === 'warmup' ? null : suggestedReps,
                completedAt: null,
              })),
        )
        .run()
    })

    return sessionId
  })
}

/**
 * D10: terminar el día A deja apuntando al B. Vive acá y no en la pantalla porque la rotación es de
 * la rutina, no del botón que la terminó (terminar desde el historial rota igual).
 *
 * `on` existe para que `endSession` la corra DENTRO de su transacción: abrir una segunda transacción
 * anidada sobre la misma conexión es un error de SQLite, y una sesión terminada con la rotación a
 * medias sería peor que no rotar.
 */
export function advanceRotation(sessionId: number, on: Db = db): void {
  const row = on
    .select({ dayId: session.routineDayId })
    .from(session)
    .where(eq(session.id, sessionId))
    .get()
  if (!row?.dayId) return

  const day = on.select().from(routineDay).where(eq(routineDay.id, row.dayId)).get()
  if (!day) return

  const days = on
    .select({ id: routineDay.id })
    .from(routineDay)
    .where(eq(routineDay.routineId, day.routineId))
    .orderBy(...DAY_ORDER)
    .all()

  const at = days.findIndex((d) => d.id === day.id)
  if (at < 0) return

  on.update(routine)
    .set({ currentDayIndex: wrap(at + 1, days.length) })
    .where(eq(routine.id, day.routineId))
    .run()
}

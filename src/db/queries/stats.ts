import { and, asc, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import { e1rmG } from '@/lib/prs'
import { db } from '../client'
import { exercise, MUSCLES, type Muscle, session, sessionExercise, vWorkSet } from '../schema'
import { getSettings } from './settings'

/**
 * Análisis (G01–G18). Todo sale de `v_work_set`, nunca de `set_entry`: una entrada en calor no es
 * volumen y una serie sin tildar no pasó (trampa #2 del plan).
 *
 * Dos relojes, a propósito:
 * - las **series** se cuentan cuando se hicieron (`completed_at`),
 * - las **sesiones** cuando empezaron (`started_at`), y solo si terminaron.
 *
 * Un entrenamiento que cruza la medianoche del domingo reparte sus series entre dos semanas y cuenta
 * como una sesión de la que empezó. Es el corte honesto más barato: la alternativa (anclar todo a la
 * sesión) hace que un lunes 00:30 aparezca en la semana pasada.
 *
 * Las semanas son ISO (arrancan lunes) en hora local, calculadas en JS: SQLite solo sabe de zonas
 * horarias con modificadores 'localtime' sobre epochs en segundos, y el redondeo a la medianoche
 * local es justo lo que no se puede equivocar acá.
 */

export const DAY_MS = 86_400_000

export function startOfDay(at: number): number {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Suma días de calendario, no de 24 h: sobrevive a un cambio de horario de verano. */
export function addDays(at: number, days: number): number {
  const d = new Date(at)
  d.setDate(d.getDate() + days)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Lunes 00:00 local de la semana de `at`. */
export function startOfWeek(at: number): number {
  const day = new Date(startOfDay(at)).getDay() // 0 = domingo
  return addDays(at, -((day + 6) % 7))
}

const VOLUME_G = sql<number>`coalesce(sum(${vWorkSet.weightG} * ${vWorkSet.reps}), 0)`
const SETS = sql<number>`count(*)`

/** `[from, to)` sobre el reloj de la serie. */
function done(from: number, to: number) {
  return and(gte(vWorkSet.completedAt, from), lt(vWorkSet.completedAt, to))
}

export type WeekSummary = { sessions: number; sets: number; volumeG: number; durationMs: number }

/**
 * G01/G05/G07 de una semana. `now` es el reloj: la ventana es `[weekStart, +7 días)` recortada a
 * ahora, así "esta semana" es "esta semana hasta acá" y un test puede pararse a mitad de semana.
 */
export function weekSummary(weekStart: number, now = Date.now()): WeekSummary {
  const to = Math.min(addDays(weekStart, 7), now + 1)
  if (to <= weekStart) return { durationMs: 0, sessions: 0, sets: 0, volumeG: 0 }

  const workouts = db
    .select({
      durationMs: sql<number>`coalesce(sum(max(0, ${session.endedAt} - ${session.startedAt} - ${session.pausedMs})), 0)`,
      sessions: sql<number>`count(*)`,
    })
    .from(session)
    .where(
      and(isNotNull(session.endedAt), gte(session.startedAt, weekStart), lt(session.startedAt, to)),
    )
    .get()

  const work = db
    .select({ sets: SETS, volumeG: VOLUME_G })
    .from(vWorkSet)
    .where(done(weekStart, to))
    .get()

  return {
    durationMs: workouts?.durationMs ?? 0,
    sessions: workouts?.sessions ?? 0,
    sets: work?.sets ?? 0,
    volumeG: work?.volumeG ?? 0,
  }
}

/**
 * G11: la comparación de la primera sección de Progreso.
 *
 * Las dos semanas se cortan en el **mismo punto**: "esta semana hasta acá" contra "la pasada hasta
 * acá". Comparar un lunes al mediodía contra siete días completos dibujaría un ▼ enorme en las
 * cuatro tarjetas que no dice nada más que qué día es hoy.
 */
export function thisAndLastWeek(now = Date.now()): { current: WeekSummary; previous: WeekSummary } {
  const current = startOfWeek(now)
  const previous = addDays(current, -7)
  return {
    current: weekSummary(current, now),
    previous: weekSummary(previous, previous + (now - current)),
  }
}

/** G01: lo que lleva hecho una sesión (la de hoy incluida, esté terminada o no). */
export function sessionVolume(sessionId: number): { sets: number; volumeG: number } {
  const row = db
    .select({ sets: SETS, volumeG: VOLUME_G })
    .from(vWorkSet)
    .innerJoin(sessionExercise, eq(sessionExercise.id, vWorkSet.sessionExerciseId))
    .where(eq(sessionExercise.sessionId, sessionId))
    .get()
  return { sets: row?.sets ?? 0, volumeG: row?.volumeG ?? 0 }
}

/** G02/G03: series y volumen por músculo primario, de mayor a menor. */
export function volumeByMuscle(
  from: number,
  to: number,
): Array<{ muscle: Muscle; sets: number; volumeG: number }> {
  return db
    .select({ muscle: exercise.primaryMuscle, sets: SETS, volumeG: VOLUME_G })
    .from(vWorkSet)
    .innerJoin(sessionExercise, eq(sessionExercise.id, vWorkSet.sessionExerciseId))
    .innerJoin(exercise, eq(exercise.id, sessionExercise.exerciseId))
    .where(done(from, to))
    .groupBy(exercise.primaryMuscle)
    .orderBy(desc(VOLUME_G), desc(SETS))
    .all()
}

/**
 * G17: series de empuje contra series de tracción. Por `exercise.pattern`, así que lo que no es ni
 * una cosa ni la otra (bisagra, sentadilla, core, aislamiento) simplemente no entra en la cuenta.
 */
export function pushPullBalance(from: number, to: number): { push: number; pull: number } {
  const row = db
    .select({
      pull: sql<number>`sum(case when ${exercise.pattern} in ('pull_h', 'pull_v') then 1 else 0 end)`,
      push: sql<number>`sum(case when ${exercise.pattern} in ('push_h', 'push_v') then 1 else 0 end)`,
    })
    .from(vWorkSet)
    .innerJoin(sessionExercise, eq(sessionExercise.id, vWorkSet.sessionExerciseId))
    .innerJoin(exercise, eq(exercise.id, sessionExercise.exerciseId))
    .where(done(from, to))
    .get()
  return { pull: row?.pull ?? 0, push: row?.push ?? 0 }
}

/**
 * G18: días desde la última serie de trabajo de cada músculo primario. Entrenado hoy = 0, nunca
 * entrenado = `null`, y esos van al final: "nunca" casi siempre significa "no está en mi programa",
 * no "me lo estoy olvidando".
 */
export function neglectedMuscles(
  now = Date.now(),
): Array<{ muscle: Muscle; daysSince: number | null }> {
  const rows = db
    .select({ last: sql<number>`max(${vWorkSet.completedAt})`, muscle: exercise.primaryMuscle })
    .from(vWorkSet)
    .innerJoin(sessionExercise, eq(sessionExercise.id, vWorkSet.sessionExerciseId))
    .innerJoin(exercise, eq(exercise.id, sessionExercise.exerciseId))
    .groupBy(exercise.primaryMuscle)
    .all()

  const last = new Map(rows.map((r) => [r.muscle, r.last]))
  const today = startOfDay(now)
  return MUSCLES.map((muscle) => {
    const at = last.get(muscle)
    return {
      daysSince: at == null ? null : Math.max(0, Math.round((today - startOfDay(at)) / DAY_MS)),
      muscle,
    }
  }).sort((a, b) => (b.daysSince ?? -1) - (a.daysSince ?? -1))
}

/**
 * G04: una fila por sesión en la que se hizo el ejercicio, de la más vieja a la más nueva (que es el
 * orden en el que se dibuja el gráfico).
 *
 * El 1RM estimado se calcula en JS y no en SQL para que la fórmula siga saliendo de ajustes y de un
 * solo lugar (trampa #4): son ~5 filas por sesión, el fold es gratis.
 */
export function exerciseSeries(
  exerciseId: number,
  limit = 30,
): Array<{ sessionId: number; date: number; maxWeightG: number; e1rmG: number; volumeG: number }> {
  const sessions = db
    .select({ date: session.startedAt, id: session.id })
    .from(session)
    .innerJoin(sessionExercise, eq(sessionExercise.sessionId, session.id))
    .innerJoin(vWorkSet, eq(vWorkSet.sessionExerciseId, sessionExercise.id))
    .where(eq(sessionExercise.exerciseId, exerciseId))
    .groupBy(session.id)
    .orderBy(desc(session.startedAt), desc(session.id))
    .limit(limit)
    .all()
  if (sessions.length === 0) return []

  const sets = db
    .select({
      reps: vWorkSet.reps,
      sessionId: sessionExercise.sessionId,
      weightG: vWorkSet.weightG,
    })
    .from(vWorkSet)
    .innerJoin(sessionExercise, eq(sessionExercise.id, vWorkSet.sessionExerciseId))
    .where(
      and(
        eq(sessionExercise.exerciseId, exerciseId),
        inArray(
          sessionExercise.sessionId,
          sessions.map((s) => s.id),
        ),
      ),
    )
    .all()

  const formula = getSettings().e1rmFormula
  const points = new Map(
    sessions.map((s) => [
      s.id,
      { date: s.date, e1rmG: 0, maxWeightG: 0, sessionId: s.id, volumeG: 0 },
    ]),
  )
  for (const set of sets) {
    const point = points.get(set.sessionId)
    if (!point || set.weightG === null || set.reps === null || set.reps < 1) continue
    point.maxWeightG = Math.max(point.maxWeightG, set.weightG)
    point.volumeG += set.weightG * set.reps
    if (set.weightG > 0) point.e1rmG = Math.max(point.e1rmG, e1rmG(set.weightG, set.reps, formula))
  }
  return [...points.values()].reverse()
}

/**
 * G06/G09: un item por día con actividad, ascendente. Los días sin nada no vuelven — el heatmap
 * dibuja la grilla y busca acá, que es más barato que devolver 84 ceros.
 */
export function trainingDays(
  from: number,
  to: number,
): Array<{ day: number; sessions: number; sets: number }> {
  const days = new Map<number, { day: number; sessions: number; sets: number }>()
  const at = (ms: number) => {
    const day = startOfDay(ms)
    const row = days.get(day) ?? { day, sessions: 0, sets: 0 }
    days.set(day, row)
    return row
  }

  const starts = db
    .select({ at: session.startedAt })
    .from(session)
    .where(and(isNotNull(session.endedAt), gte(session.startedAt, from), lt(session.startedAt, to)))
    .all()
  for (const row of starts) at(row.at).sessions += 1

  const sets = db
    .select({ at: vWorkSet.completedAt })
    .from(vWorkSet)
    .where(done(from, to))
    .orderBy(asc(vWorkSet.completedAt))
    .all()
  for (const row of sets) if (row.at !== null) at(row.at).sets += 1

  return [...days.values()].sort((a, b) => a.day - b.day)
}

/**
 * G08: semanas seguidas con al menos una sesión terminada. Cuenta desde esta semana o desde la
 * pasada — un lunes a la mañana la racha todavía no se rompió, y ponerla en 0 hasta que entrenes
 * sería mentir sobre lo que hiciste.
 */
export function streakWeeks(now = Date.now()): number {
  const weeks = new Set(
    db
      .select({ at: session.startedAt })
      .from(session)
      .where(isNotNull(session.endedAt))
      .all()
      .map((r) => startOfWeek(r.at)),
  )

  const current = startOfWeek(now)
  let cursor = weeks.has(current) ? current : addDays(current, -7)
  let n = 0
  while (weeks.has(cursor)) {
    n += 1
    cursor = addDays(cursor, -7)
  }
  return n
}

/** G05: todo lo levantado, de siempre. */
export function totalTonnageG(): number {
  return db.select({ g: VOLUME_G }).from(vWorkSet).get()?.g ?? 0
}

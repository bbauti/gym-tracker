import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import {
  DEFAULT_LANDMARKS,
  DELOAD_DAYS,
  type DeloadState,
  deloadAdvice,
  detectStall,
  type Landmark,
  type LoadEntry,
  muscleLoad,
  type SessionSnapshot,
  type Suggestion,
  suggest,
} from '@/lib/progression'
import { db } from '../client'
import {
  exercise,
  type Feedback,
  MUSCLES,
  type Muscle,
  session,
  sessionExercise,
  settings,
  vWorkSet,
} from '../schema'
import { addDays, DAY_MS } from './stats'

/**
 * La capa de db de la progresión (E01–E09). Todo lee `v_work_set`: una entrada en calor no sugiere,
 * no estanca y no cuenta como volumen semanal (trampa #2 del plan).
 *
 * Nada de acá escribe en `routine*`: la app sugiere, nunca aplica (§2.2). Lo único que se guarda es
 * la sugerencia (en `set_entry.suggested_weight_g` / `session_exercise.suggested_reason`, que la
 * pantalla dibuja como fantasma), el feedback del usuario y los ajustes del deload.
 */

// biome-ignore lint/suspicious/noExplicitAny: los parámetros del driver, que son justo lo que varía
type Db = BaseSQLiteDatabase<'sync', any, any, any>

/** Cuántas sesiones mira una sugerencia. Tres alcanzan para el estancamiento, la quinta es colchón. */
const HISTORY_LIMIT = 5
/** Ventana de "lo que venís entrenando" para el consejo de deload (E06). */
const RECENT_DAYS = 14
/** Sesiones con esfuerzo anotado que promedia el consejo de deload. */
const RPE_SESSIONS = 5
/** Ventana del mapa de recuperación (E08). */
const LOAD_DAYS = 7

/** El esfuerzo de la serie en escala RPE, con el RIR dado vuelta. `null` si no se anotó ninguno. */
const EFFORT = sql<number | null>`coalesce(${vWorkSet.rpe}, 10 - ${vWorkSet.rir})`

function settingsOn(on: Db) {
  const row = on.select().from(settings).where(eq(settings.id, 1)).get()
  if (!row) throw new Error('settings row missing: seed() did not run before this read')
  return row
}

/**
 * Las últimas sesiones en las que se hizo el ejercicio, de la más nueva a la más vieja, con sus
 * series de trabajo y el feedback que se dejó ese día.
 *
 * `excludeSessionId` es para el que está entrenando ahora: sugerir a partir de lo que todavía se
 * está anotando sería la app persiguiéndose la cola.
 */
export function workSetHistory(
  exerciseId: number,
  options: { limit?: number; excludeSessionId?: number; on?: Db } = {},
): SessionSnapshot[] {
  const on: Db = options.on ?? db
  const mine = eq(sessionExercise.exerciseId, exerciseId)
  const notThisOne =
    options.excludeSessionId === undefined
      ? undefined
      : sql`${sessionExercise.sessionId} <> ${options.excludeSessionId}`

  const sessions = on
    .select({ at: session.startedAt, id: session.id })
    .from(session)
    .innerJoin(sessionExercise, eq(sessionExercise.sessionId, session.id))
    .innerJoin(vWorkSet, eq(vWorkSet.sessionExerciseId, sessionExercise.id))
    .where(and(mine, notThisOne))
    .groupBy(session.id)
    .orderBy(desc(session.startedAt), desc(session.id))
    .limit(options.limit ?? HISTORY_LIMIT)
    .all()
  if (sessions.length === 0) return []

  const rows = on
    .select({
      feedback: sessionExercise.feedback,
      reps: vWorkSet.reps,
      rir: vWorkSet.rir,
      rpe: vWorkSet.rpe,
      sessionId: sessionExercise.sessionId,
      targetRepsMax: vWorkSet.targetRepsMax,
      targetRepsMin: vWorkSet.targetRepsMin,
      weightG: vWorkSet.weightG,
    })
    .from(vWorkSet)
    .innerJoin(sessionExercise, eq(sessionExercise.id, vWorkSet.sessionExerciseId))
    .where(
      and(
        mine,
        inArray(
          sessionExercise.sessionId,
          sessions.map((s) => s.id),
        ),
      ),
    )
    // Orden fijo: `suggest` lee el rango de reps de la primera serie, y "primera" tiene que ser la
    // del primer bloque y no la que devuelva SQLite ese día.
    .orderBy(
      asc(sessionExercise.orderIndex),
      asc(sessionExercise.id),
      asc(vWorkSet.orderIndex),
      asc(vWorkSet.id),
    )
    .all()

  const bySession = new Map<number, SessionSnapshot>(
    sessions.map((s) => [s.id, { at: s.at, feedback: null, sets: [] }]),
  )
  for (const r of rows) {
    const snapshot = bySession.get(r.sessionId)
    if (!snapshot) continue
    // El mismo ejercicio puede estar dos veces en la sesión (dos bloques): gana el primer feedback.
    if (snapshot.feedback === null && r.feedback) snapshot.feedback = r.feedback
    snapshot.sets.push({
      reps: r.reps,
      rir: r.rir,
      rpe: r.rpe,
      targetRepsMax: r.targetRepsMax,
      targetRepsMin: r.targetRepsMin,
      weightG: r.weightG,
    })
  }
  return sessions.map((s) => bySession.get(s.id) as SessionSnapshot)
}

/**
 * El peso que la app va a ofrecer, con el porqué. El incremento sale del ejercicio y, si no tiene,
 * de ajustes; el deload y el modo de esfuerzo, de ajustes.
 */
export function suggestFor(
  on: Db,
  exerciseId: number,
  options: {
    excludeSessionId?: number
    targetRepsMin?: number | null
    targetRepsMax?: number | null
    targetRpe?: number | null
  } = {},
): Suggestion {
  const config = settingsOn(on)
  const row = on
    .select({ incrementG: exercise.defaultIncrementG })
    .from(exercise)
    .where(eq(exercise.id, exerciseId))
    .get()

  return suggest(workSetHistory(exerciseId, { excludeSessionId: options.excludeSessionId, on }), {
    deload: config.deloadUntil !== null && config.deloadUntil > Date.now(),
    incrementG: row?.incrementG ?? config.defaultIncrementG,
    rpeMode: config.rpeMode,
    targetRepsMax: options.targetRepsMax,
    targetRepsMin: options.targetRepsMin,
    targetRpe: options.targetRpe,
  })
}

/** E05, para la pantalla del ejercicio. */
export function isStalled(exerciseId: number): boolean {
  return detectStall(workSetHistory(exerciseId, { limit: 3 }))
}

function trainedRecently(now: number): number[] {
  return db
    .selectDistinct({ id: sessionExercise.exerciseId })
    .from(vWorkSet)
    .innerJoin(sessionExercise, eq(sessionExercise.id, vWorkSet.sessionExerciseId))
    .where(gte(vWorkSet.completedAt, now - RECENT_DAYS * DAY_MS))
    .all()
    .map((r) => r.id)
}

/**
 * El promedio de esfuerzo de las últimas sesiones que lo tengan anotado, y cuántas fueron. Acotado a
 * la misma ventana que el resto del consejo: el RPE de hace tres meses no dice cómo venís ahora.
 */
function recentEffort(now: number): { avgRpe: number | null; rpeSessions: number } {
  const rows = db
    .select({ avg: sql<number>`avg(${EFFORT})`, id: session.id })
    .from(vWorkSet)
    .innerJoin(sessionExercise, eq(sessionExercise.id, vWorkSet.sessionExerciseId))
    .innerJoin(session, eq(session.id, sessionExercise.sessionId))
    .where(and(sql`${EFFORT} is not null`, gte(vWorkSet.completedAt, now - RECENT_DAYS * DAY_MS)))
    .groupBy(session.id)
    .orderBy(desc(session.startedAt), desc(session.id))
    .limit(RPE_SESSIONS)
    .all()
  if (rows.length === 0) return { avgRpe: null, rpeSessions: 0 }
  return {
    avgRpe: rows.reduce((sum, r) => sum + r.avg, 0) / rows.length,
    rpeSessions: rows.length,
  }
}

/**
 * E06: si conviene bajar una semana, si ya se está bajando, y hasta cuándo.
 *
 * ponytail: `isStalled` por ejercicio son dos queries indexadas cada una. Techo: ~10 ejercicios en
 * dos semanas = ~20 queries en la tab de entrenar. Upgrade: una sola query con los últimos 3
 * 1RM estimados por ejercicio (CTE con row_number) si alguna vez se nota.
 */
export function deloadState(now = Date.now()): DeloadState {
  const config = settingsOn(db)
  const trained = trainedRecently(now)
  const stalled = trained.filter(isStalled).length
  return deloadAdvice({
    ...recentEffort(now),
    deloadDismissedAt: config.deloadDismissedAt,
    deloadEndedAt: config.deloadEndedAt,
    deloadUntil: config.deloadUntil,
    exercisesTrained: trained.length,
    now,
    stalledShare: trained.length === 0 ? 0 : stalled / trained.length,
  })
}

function patchSettings(patch: Partial<typeof settings.$inferInsert>): void {
  db.update(settings).set(patch).where(eq(settings.id, 1)).run()
}

/** Empieza la semana liviana. Solo mueve el reloj: las rutinas y el calendario no se tocan. */
export function startDeload(now = Date.now()): void {
  patchSettings({ deloadUntil: now + DELOAD_DAYS * DAY_MS })
}

/** Terminarla a mano. `deload_ended_at` es la ventana de silencio, no historial. */
export function endDeload(now = Date.now()): void {
  patchSettings({ deloadEndedAt: now, deloadUntil: null })
}

export function dismissDeload(now = Date.now()): void {
  patchSettings({ deloadDismissedAt: now })
}

/**
 * E07. Series duras de la semana por músculo: el primario cuenta 1 y cada secundario 0,5. Devuelve
 * TODOS los músculos (los de cero incluidos) — "no lo entrenaste" es justo lo que la pantalla de
 * landmarks tiene que poder decir.
 */
export function weeklyHardSets(weekStart: number): Array<{ muscle: Muscle; sets: number }> {
  const rows = db
    .select({
      primary: exercise.primaryMuscle,
      secondary: exercise.secondaryMuscles,
      sets: sql<number>`count(*)`,
    })
    .from(vWorkSet)
    .innerJoin(sessionExercise, eq(sessionExercise.id, vWorkSet.sessionExerciseId))
    .innerJoin(exercise, eq(exercise.id, sessionExercise.exerciseId))
    .where(
      and(gte(vWorkSet.completedAt, weekStart), lt(vWorkSet.completedAt, addDays(weekStart, 7))),
    )
    .groupBy(exercise.id)
    .all()

  const total = {} as Record<Muscle, number>
  for (const muscle of MUSCLES) total[muscle] = 0
  for (const r of rows) {
    total[r.primary] += r.sets
    for (const m of r.secondary ?? []) total[m] += r.sets / 2
  }
  return MUSCLES.map((muscle) => ({ muscle, sets: total[muscle] })).sort((a, b) => b.sets - a.sets)
}

/** Los landmarks por defecto con lo que el usuario haya cambiado encima. */
export function landmarks(): Record<Muscle, Landmark> {
  const custom = settingsOn(db).volumeLandmarks
  if (!custom) return DEFAULT_LANDMARKS
  return { ...DEFAULT_LANDMARKS, ...custom }
}

export function setLandmark(muscle: Muscle, lm: Landmark): void {
  patchSettings({ volumeLandmarks: { ...settingsOn(db).volumeLandmarks, [muscle]: lm } })
}

/** E08. Carga reciente por músculo (0 a 1) para el mapa de recuperación. */
export function recentMuscleLoad(now = Date.now()): Record<Muscle, number> {
  const rows = db
    .select({
      at: vWorkSet.completedAt,
      primary: exercise.primaryMuscle,
      secondary: exercise.secondaryMuscles,
    })
    .from(vWorkSet)
    .innerJoin(sessionExercise, eq(sessionExercise.id, vWorkSet.sessionExerciseId))
    .innerJoin(exercise, eq(exercise.id, sessionExercise.exerciseId))
    .where(gte(vWorkSet.completedAt, now - LOAD_DAYS * DAY_MS))
    .all()

  const entries: LoadEntry[] = []
  for (const r of rows) {
    if (r.at === null) continue
    entries.push({ at: r.at, muscle: r.primary, weight: 1 })
    for (const m of r.secondary ?? []) entries.push({ at: r.at, muscle: m, weight: 0.5 })
  }

  // Con TODOS los músculos, cero incluido: el mapa dibuja el cuerpo entero y no quiere preguntarse
  // si un `undefined` es "descansado" o "no lo sé".
  const partial = muscleLoad(entries, now)
  const load = {} as Record<Muscle, number>
  for (const muscle of MUSCLES) load[muscle] = partial[muscle] ?? 0
  return load
}

/** E09. Lo que el usuario contestó del ejercicio. `null` lo borra. */
export function setFeedback(seId: number, feedback: Feedback | null): void {
  db.update(sessionExercise).set({ feedback }).where(eq(sessionExercise.id, seId)).run()
}

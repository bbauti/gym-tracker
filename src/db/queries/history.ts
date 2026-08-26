import { and, desc, getTableColumns, gte, isNotNull, lt, type SQL, sql } from 'drizzle-orm'
import { db } from '../client'
import { session } from '../schema'
import type { SessionRow } from './session'
import { addDays } from './stats'

export type SessionSummary = {
  session: SessionRow
  exerciseCount: number
  /** Completed sets only: a row the user typed into but never ticked is not a set they did. */
  setCount: number
  /** Sum of weight × reps over `v_work_set`: warm-ups and uncompleted sets never count. */
  volumeG: number
  /** Wall clock minus the time the workout spent paused. */
  durationMs: number
}

// Hand-written SQL, not `${table.column}`: drizzle drops the table qualifier in the select list of a
// single-table query, so an interpolated `session.id` comes out as a bare `"id"` that the correlated
// subquery resolves against its own FROM ("ambiguous column name", or worse, silently wrong).
const EXERCISE_COUNT = sql<number>`(
  select count(*) from "session_exercise"
  where "session_exercise"."session_id" = "session"."id"
)`
const SET_COUNT = sql<number>`(
  select count(*) from "set_entry"
  join "session_exercise" on "session_exercise"."id" = "set_entry"."session_exercise_id"
  where "session_exercise"."session_id" = "session"."id" and "set_entry"."completed_at" is not null
)`
const VOLUME_G = sql<number>`(
  select coalesce(sum("v_work_set"."weight_g" * "v_work_set"."reps"), 0) from "v_work_set"
  join "session_exercise" on "session_exercise"."id" = "v_work_set"."session_exercise_id"
  where "session_exercise"."session_id" = "session"."id"
)`

/** El mismo select para las tres listas: la única diferencia es el WHERE. */
function summaries(where: SQL | undefined, limit: number, offset = 0): SessionSummary[] {
  const rows = db
    .select({
      ...getTableColumns(session),
      exerciseCount: EXERCISE_COUNT,
      setCount: SET_COUNT,
      volumeG: VOLUME_G,
    })
    .from(session)
    .where(and(isNotNull(session.endedAt), where))
    .orderBy(desc(session.startedAt), desc(session.id))
    .limit(limit)
    .offset(offset)
    .all()

  return rows.map(({ exerciseCount, setCount, volumeG, ...row }) => ({
    session: row,
    exerciseCount,
    setCount,
    volumeG,
    durationMs: Math.max(0, (row.endedAt ?? row.startedAt) - row.startedAt - row.pausedMs),
  }))
}

/**
 * Finished workouts, newest first. Correlated subqueries instead of joins: joining three children of
 * `session` in one query multiplies the rows and every count comes out wrong.
 *
 * D09: `day` es la medianoche local (`startOfDay`) del día que el calendario tiene seleccionado, y
 * filtra por cuándo EMPEZÓ la sesión — el mismo reloj con el que el calendario pinta sus puntos, así
 * que un entrenamiento que cruza la medianoche cae en el día en el que se sentó a entrenar.
 */
export function listSessions(opts?: {
  limit?: number
  offset?: number
  day?: number
}): SessionSummary[] {
  const day = opts?.day
  // `addDays` suma días de calendario, no 24 h: sobrevive a un cambio de horario de verano.
  const where =
    day === undefined
      ? undefined
      : and(gte(session.startedAt, day), lt(session.startedAt, addDays(day, 1)))
  return summaries(where, opts?.limit ?? 50, opts?.offset ?? 0)
}

/** `%` y `_` los escribe el usuario en el buscador, no son comodines suyos. */
const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`)

/**
 * S02. Busca en lo que el usuario escribió (nombre y notas de la sesión, notas del ejercicio) y en
 * los nombres del catálogo, en los dos idiomas: "banca" encuentra el día en el que hiciste press
 * banca aunque la sesión se llame "Torso".
 *
 * ponytail: LIKE, que en SQLite ignora mayúsculas solo en ASCII y no ignora acentos ("prensa" no
 * encuentra "Presión"). Techo: los acentos. Upgrade: el mismo FTS que el catálogo, con una tabla
 * propia para las sesiones.
 */
export function searchSessions(q: string, opts?: { limit?: number }): SessionSummary[] {
  const trimmed = q.trim()
  if (!trimmed) return listSessions(opts)
  const p = `%${escapeLike(trimmed)}%`
  const match = sql`(
    "session"."name" like ${p} escape '\\' or "session"."note" like ${p} escape '\\' or exists (
      select 1 from "session_exercise"
      join "exercise" on "exercise"."id" = "session_exercise"."exercise_id"
      where "session_exercise"."session_id" = "session"."id"
        and ("session_exercise"."note" like ${p} escape '\\'
          or "exercise"."name_es" like ${p} escape '\\'
          or "exercise"."name_en" like ${p} escape '\\')
    ))`
  return summaries(match, opts?.limit ?? 50)
}

import { desc, getTableColumns, isNotNull, sql } from 'drizzle-orm'
import { db } from '../client'
import { session } from '../schema'
import type { SessionRow } from './session'

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

/**
 * Finished workouts, newest first. Correlated subqueries instead of joins: joining three children of
 * `session` in one query multiplies the rows and every count comes out wrong.
 */
export function listSessions(opts?: { limit?: number; offset?: number }): SessionSummary[] {
  const rows = db
    .select({
      ...getTableColumns(session),
      exerciseCount: EXERCISE_COUNT,
      setCount: SET_COUNT,
      volumeG: VOLUME_G,
    })
    .from(session)
    .where(isNotNull(session.endedAt))
    .orderBy(desc(session.startedAt), desc(session.id))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0)
    .all()

  return rows.map(({ exerciseCount, setCount, volumeG, ...row }) => ({
    session: row,
    exerciseCount,
    setCount,
    volumeG,
    durationMs: Math.max(0, (row.endedAt ?? row.startedAt) - row.startedAt - row.pausedMs),
  }))
}

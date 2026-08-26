import { and, asc, desc, eq, exists, isNotNull, ne, sql } from 'drizzle-orm'
import { db } from '../client'
import { session, sessionExercise, setEntry } from '../schema'
import type { SetRow } from './session'

export type SetPatch = Partial<
  Pick<
    SetRow,
    'weightG' | 'reps' | 'durationMs' | 'distanceMm' | 'rpe' | 'rir' | 'kind' | 'side' | 'note'
  >
>

/**
 * "Same again": the new row starts as a copy of the last one (values and kind), uncompleted. Typing
 * over it is one tap cheaper than typing it from scratch, and most sets repeat.
 */
export function addSet(seId: number): number {
  return db.transaction((tx) => {
    const prev = tx
      .select()
      .from(setEntry)
      .where(eq(setEntry.sessionExerciseId, seId))
      .orderBy(desc(setEntry.orderIndex), desc(setEntry.id))
      .limit(1)
      .get()

    return tx
      .insert(setEntry)
      .values({
        sessionExerciseId: seId,
        orderIndex: prev ? prev.orderIndex + 1 : 0,
        kind: prev?.kind ?? 'normal',
        weightG: prev?.weightG ?? null,
        reps: prev?.reps ?? null,
        durationMs: prev?.durationMs ?? null,
        distanceMm: prev?.distanceMm ?? null,
      })
      .returning({ id: setEntry.id })
      .get().id
  })
}

export function getSet(setId: number): SetRow | null {
  return db.select().from(setEntry).where(eq(setEntry.id, setId)).get() ?? null
}

export function updateSet(setId: number, patch: SetPatch): void {
  if (Object.keys(patch).length === 0) return
  db.update(setEntry).set(patch).where(eq(setEntry.id, setId)).run()
}

/**
 * One transaction: the values (`fill` carries the ghost values when the user typed nothing), the
 * tick, and the rest timer. One write, one change notification, one re-render.
 */
export function completeSet(
  setId: number,
  sessionId: number,
  fill: SetPatch,
  restSec: number | null,
): void {
  const now = Date.now()
  db.transaction((tx) => {
    tx.update(setEntry)
      .set({ ...fill, completedAt: now })
      .where(eq(setEntry.id, setId))
      .run()
    if (restSec !== null) {
      tx.update(session)
        .set({ restEndsAt: now + restSec * 1000 })
        .where(eq(session.id, sessionId))
        .run()
    }
  })
}

/** Only the tick: the values stay, because un-ticking is "wait, that was wrong", not "delete". */
export function uncompleteSet(setId: number): void {
  db.update(setEntry).set({ completedAt: null }).where(eq(setEntry.id, setId)).run()
}

/** Returns the row so the undo toast can put it back exactly as it was. */
export function deleteSet(setId: number): SetRow {
  const row = db.delete(setEntry).where(eq(setEntry.id, setId)).returning().get()
  if (!row) throw new Error(`set ${setId} not found`)
  return row
}

/** Same id and same orderIndex: undo restores the row in place, not at the end. */
export function restoreSet(row: SetRow): void {
  db.insert(setEntry).values(row).run()
}

/**
 * The ghost values: every completed set of the last time this exercise was trained, in a *different*
 * session. Two round trips — find the session_exercise, then read its sets.
 */
export function prevSets(exerciseId: number, excludeSessionId: number): SetRow[] {
  const previous = db
    .select({ id: sessionExercise.id })
    .from(sessionExercise)
    .innerJoin(session, eq(session.id, sessionExercise.sessionId))
    .where(
      and(
        eq(sessionExercise.exerciseId, exerciseId),
        ne(sessionExercise.sessionId, excludeSessionId),
        exists(
          db
            .select({ one: sql`1` })
            .from(setEntry)
            .where(
              and(
                eq(setEntry.sessionExerciseId, sessionExercise.id),
                isNotNull(setEntry.completedAt),
              ),
            ),
        ),
      ),
    )
    .orderBy(desc(session.startedAt), desc(sessionExercise.id))
    .limit(1)
    .get()

  if (!previous) return []

  return db
    .select()
    .from(setEntry)
    .where(and(eq(setEntry.sessionExerciseId, previous.id), isNotNull(setEntry.completedAt)))
    .orderBy(asc(setEntry.orderIndex), asc(setEntry.id))
    .all()
}

import { and, asc, desc, eq, inArray, isNull, notExists, sql } from 'drizzle-orm'
import { db } from '../client'
import { exercise, session, sessionExercise, setEntry } from '../schema'
import type { Exercise } from './exercises'

export type SessionRow = typeof session.$inferSelect
export type SessionExerciseRow = typeof sessionExercise.$inferSelect
export type SetRow = typeof setEntry.$inferSelect

/** Everything the session screen renders, in one shape. Exercises by `orderIndex`, sets by theirs. */
export type SessionTree = {
  session: SessionRow
  exercises: Array<{ se: SessionExerciseRow; exercise: Exercise; sets: SetRow[] }>
}

/** The workout in progress, if any. Newest wins: there should only ever be one. */
export function getActiveSessionId(): number | null {
  const row = db
    .select({ id: session.id })
    .from(session)
    .where(isNull(session.endedAt))
    .orderBy(desc(session.startedAt), desc(session.id))
    .limit(1)
    .get()
  return row?.id ?? null
}

export function createSession(input?: { name?: string | null; startedAt?: number }): number {
  return db
    .insert(session)
    .values({ name: input?.name ?? null, startedAt: input?.startedAt ?? Date.now() })
    .returning({ id: session.id })
    .get().id
}

export function getSession(id: number): SessionRow | null {
  return db.select().from(session).where(eq(session.id, id)).get() ?? null
}

export function getSessionExercise(seId: number): SessionExerciseRow | null {
  return db.select().from(sessionExercise).where(eq(sessionExercise.id, seId)).get() ?? null
}

/** Three round trips (session · exercises · sets), never one per row. */
export function getSessionTree(id: number): SessionTree | null {
  const row = getSession(id)
  if (!row) return null

  const rows = db
    .select()
    .from(sessionExercise)
    .innerJoin(exercise, eq(exercise.id, sessionExercise.exerciseId))
    .where(eq(sessionExercise.sessionId, id))
    .orderBy(asc(sessionExercise.orderIndex), asc(sessionExercise.id))
    .all()

  const seIds = rows.map((r) => r.session_exercise.id)
  const sets =
    seIds.length === 0
      ? []
      : db
          .select()
          .from(setEntry)
          .where(inArray(setEntry.sessionExerciseId, seIds))
          .orderBy(asc(setEntry.orderIndex), asc(setEntry.id))
          .all()

  const bySe = new Map<number, SetRow[]>()
  for (const s of sets) {
    const list = bySe.get(s.sessionExerciseId)
    if (list) list.push(s)
    else bySe.set(s.sessionExerciseId, [s])
  }

  return {
    session: row,
    exercises: rows.map((r) => ({
      se: r.session_exercise,
      exercise: r.exercise,
      sets: bySe.get(r.session_exercise.id) ?? [],
    })),
  }
}

/** Appends the exercise plus one empty set: an exercise with no rows to type into is useless. */
export function addExercise(sessionId: number, exerciseId: number): number {
  return db.transaction((tx) => {
    const next = tx
      .select({ n: sql<number>`coalesce(max(${sessionExercise.orderIndex}) + 1, 0)` })
      .from(sessionExercise)
      .where(eq(sessionExercise.sessionId, sessionId))
      .get()

    const seId = tx
      .insert(sessionExercise)
      .values({ sessionId, exerciseId, orderIndex: next?.n ?? 0 })
      .returning({ id: sessionExercise.id })
      .get().id

    tx.insert(setEntry).values({ sessionExerciseId: seId, orderIndex: 0, kind: 'normal' }).run()
    return seId
  })
}

export type SessionExerciseSnapshot = { se: SessionExerciseRow; sets: SetRow[] }

/**
 * Its sets go with it (FK cascade), so removing is destructive and asks nothing: the snapshot it
 * returns is what the undo toast needs to put the card back with everything that was logged in it.
 */
export function removeSessionExercise(seId: number): SessionExerciseSnapshot | null {
  return db.transaction((tx) => {
    const se = tx.select().from(sessionExercise).where(eq(sessionExercise.id, seId)).get()
    if (!se) return null
    const sets = tx
      .select()
      .from(setEntry)
      .where(eq(setEntry.sessionExerciseId, seId))
      .orderBy(asc(setEntry.orderIndex), asc(setEntry.id))
      .all()
    tx.delete(sessionExercise).where(eq(sessionExercise.id, seId)).run()
    return { se, sets }
  })
}

/** Same ids and same orderIndex, sets included: undo puts the card back where it was. */
export function restoreSessionExercise(snapshot: SessionExerciseSnapshot): void {
  db.transaction((tx) => {
    tx.insert(sessionExercise).values(snapshot.se).run()
    if (snapshot.sets.length > 0) tx.insert(setEntry).values(snapshot.sets).run()
  })
}

/** One transaction, so the list never renders half-reordered. Ids from another session are ignored. */
export function reorderExercises(sessionId: number, orderedSeIds: number[]): void {
  db.transaction((tx) => {
    orderedSeIds.forEach((seId, index) => {
      tx.update(sessionExercise)
        .set({ orderIndex: index })
        .where(and(eq(sessionExercise.id, seId), eq(sessionExercise.sessionId, sessionId)))
        .run()
    })
  })
}

/** Keeps the sets: swapping is "I did this on the other machine", not "start over". */
export function swapExercise(seId: number, exerciseId: number): void {
  db.update(sessionExercise).set({ exerciseId }).where(eq(sessionExercise.id, seId)).run()
}

export function updateSessionExercise(seId: number, patch: { note?: string | null }): void {
  if (Object.keys(patch).length === 0) return
  db.update(sessionExercise).set(patch).where(eq(sessionExercise.id, seId)).run()
}

export function updateSession(
  id: number,
  patch: Partial<
    Pick<SessionRow, 'name' | 'note' | 'startedAt' | 'endedAt' | 'pausedMs' | 'restEndsAt'>
  >,
): void {
  if (Object.keys(patch).length === 0) return
  db.update(session).set(patch).where(eq(session.id, id)).run()
}

/**
 * Closes the workout and sweeps the scaffolding: the empty set every exercise is born with, and the
 * exercises that end up with none. A set the user typed into but never ticked survives — it is data.
 */
export function endSession(id: number): void {
  db.transaction((tx) => {
    const seIds = tx
      .select({ id: sessionExercise.id })
      .from(sessionExercise)
      .where(eq(sessionExercise.sessionId, id))
      .all()
      .map((r) => r.id)

    if (seIds.length > 0) {
      tx.delete(setEntry)
        .where(
          and(
            inArray(setEntry.sessionExerciseId, seIds),
            isNull(setEntry.completedAt),
            isNull(setEntry.weightG),
            isNull(setEntry.reps),
            isNull(setEntry.durationMs),
            isNull(setEntry.distanceMm),
          ),
        )
        .run()

      tx.delete(sessionExercise)
        .where(
          and(
            eq(sessionExercise.sessionId, id),
            notExists(
              tx
                .select({ one: sql`1` })
                .from(setEntry)
                .where(eq(setEntry.sessionExerciseId, sessionExercise.id)),
            ),
          ),
        )
        .run()
    }

    tx.update(session)
      .set({ endedAt: Date.now(), restEndsAt: null })
      .where(eq(session.id, id))
      .run()
  })
}

/** Exercises and sets go with it (FK cascade). */
export function deleteSession(id: number): void {
  db.delete(session).where(eq(session.id, id)).run()
}

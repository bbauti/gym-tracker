import { and, asc, desc, eq, exists, isNotNull, ne, sql } from 'drizzle-orm'
import type { PrKind } from '@/lib/prs'
import { db } from '../client'
import { session, sessionExercise, setEntry } from '../schema'
import { recomputeExercisePrs, recordPrs, setOwner } from './prs'
import type { SetRow } from './session'

/**
 * Las columnas que pueden mover un récord. Cambiar una nota o el RPE de una serie completada no
 * obliga a reproducir el ejercicio; cambiar el peso, las reps o el tipo, sí.
 */
const PR_COLUMNS = ['weightG', 'reps', 'kind'] as const

export type SetPatch = Partial<
  Pick<
    SetRow,
    'weightG' | 'reps' | 'durationMs' | 'distanceMm' | 'rpe' | 'rir' | 'kind' | 'side' | 'note'
  >
>

/**
 * "Same again": the new row starts as a copy of the last one (values and kind), uncompleted. Typing
 * over it is one tap cheaper than typing it from scratch, and most sets repeat.
 *
 * El objetivo del día y el peso sugerido viajan con la copia (D06/D07): una quinta serie agregada a
 * mano en un día de rutina es "una más igual", y sin esto sería la única fila del ejercicio sin
 * fantasma ni objetivo. Siguen siendo sugerencias — nada las aplica hasta que se tilda (§2.2).
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
        targetRepsMin: prev?.targetRepsMin ?? null,
        targetRepsMax: prev?.targetRepsMax ?? null,
        suggestedWeightG: prev?.suggestedWeightG ?? null,
      })
      .returning({ id: setEntry.id })
      .get().id
  })
}

/**
 * J06: las series de entrada en calor entran ARRIBA de las que ya estaban, no al final. Un solo
 * write: correr el orden de las existentes y meter las nuevas van en la misma transacción, o entre
 * las dos queda un `order_index` duplicado que la pantalla dibujaría mezclado.
 */
export function addWarmupSets(seId: number, rows: Array<{ weightG: number; reps: number }>): void {
  if (rows.length === 0) return
  db.transaction((tx) => {
    tx.update(setEntry)
      .set({ orderIndex: sql`${setEntry.orderIndex} + ${rows.length}` })
      .where(eq(setEntry.sessionExerciseId, seId))
      .run()
    tx.insert(setEntry)
      .values(
        rows.map((row, i) => ({
          sessionExerciseId: seId,
          orderIndex: i,
          kind: 'warmup' as const,
          weightG: row.weightG,
          reps: row.reps,
        })),
      )
      .run()
  })
}

export function getSet(setId: number): SetRow | null {
  return db.select().from(setEntry).where(eq(setEntry.id, setId)).get() ?? null
}

/**
 * Si el patch **cambia** algo que mueve un récord. `flush()` manda el patch entero en cada blur, así
 * que el caso normal es "el mismo peso que ya estaba": comparar contra la fila (un lookup por pk)
 * sale mucho más barato que reproducir el historial completo del ejercicio por nada.
 */
function movesRecords(setId: number, patch: SetPatch): boolean {
  const touched = PR_COLUMNS.filter((c) => c in patch)
  if (touched.length === 0) return false
  const row = getSet(setId)
  return row !== null && touched.some((c) => patch[c] !== row[c])
}

export function updateSet(setId: number, patch: SetPatch): void {
  if (Object.keys(patch).length === 0) return
  if (!movesRecords(setId, patch)) {
    db.update(setEntry).set(patch).where(eq(setEntry.id, setId)).run()
    return
  }
  // Editar una serie YA completada reescribe el historial: el récord que dio puede no darlo más, y
  // uno que quedó tapado puede pasar a valer. `personal_record` es cache, así que se reconstruye.
  db.transaction((tx) => {
    tx.update(setEntry).set(patch).where(eq(setEntry.id, setId)).run()
    const owner = setOwner(tx, setId)
    if (owner && owner.completedAt !== null) recomputeExercisePrs(owner.exerciseId, tx)
  })
}

/**
 * One transaction: the values (`fill` carries the ghost values when the user typed nothing), the
 * tick, the rest timer and the records (H01–H05). One write, one change notification, one re-render
 * — la fila ya sale con `is_pr` puesto, sin un segundo viaje ni un event bus.
 *
 * Devuelve los récords que se rompieron para que la pantalla decida el háptico y el badge.
 */
export function completeSet(
  setId: number,
  sessionId: number,
  fill: SetPatch,
  restSec: number | null,
): PrKind[] {
  const now = Date.now()
  return db.transaction((tx) => {
    tx.update(setEntry)
      .set({ ...fill, completedAt: now })
      .where(eq(setEntry.id, setId))
      .run()
    // `> 0` y no solo `!== null`: un ejercicio con 0 s de descanso no estampa un `rest_ends_at` ya
    // vencido en la fila. La barra igual no se dibujaba, pero ese valor muerto es justo lo que
    // `resumeSession` correría hacia el futuro.
    if (restSec !== null && restSec > 0) {
      tx.update(session)
        .set({ restEndsAt: now + restSec * 1000 })
        .where(eq(session.id, sessionId))
        .run()
    }
    return recordPrs(tx, setId)
  })
}

/** Only the tick: the values stay, because un-ticking is "wait, that was wrong", not "delete". */
export function uncompleteSet(setId: number): void {
  db.transaction((tx) => {
    tx.update(setEntry).set({ completedAt: null }).where(eq(setEntry.id, setId)).run()
    const owner = setOwner(tx, setId)
    if (owner) recomputeExercisePrs(owner.exerciseId, tx)
  })
}

/** Returns the row so the undo toast can put it back exactly as it was. */
export function deleteSet(setId: number): SetRow {
  return db.transaction((tx) => {
    // El ejercicio se lee ANTES: después del delete no hay fila de la que sacarlo.
    const owner = setOwner(tx, setId)
    const row = tx.delete(setEntry).where(eq(setEntry.id, setId)).returning().get()
    if (!row) throw new Error(`set ${setId} not found`)
    if (owner && owner.completedAt !== null) recomputeExercisePrs(owner.exerciseId, tx)
    return row
  })
}

/**
 * Same id and same orderIndex: undo restores the row in place, not at the end. A no-op if the
 * exercise (or the whole session) is gone by the time undo is tapped — the toast outlives the
 * screen, and the FK insert would throw inside its onPress.
 */
export function restoreSet(row: SetRow): void {
  db.transaction((tx) => {
    const se = tx
      .select({ exerciseId: sessionExercise.exerciseId })
      .from(sessionExercise)
      .where(eq(sessionExercise.id, row.sessionExerciseId))
      .get()
    if (!se) return
    tx.insert(setEntry).values(row).run()
    // Volvió una serie completada: sus récords se fueron con el borrado (FK cascade) y las que
    // vinieron después pueden haberlos heredado. Se reproduce el ejercicio y quedan como estaban.
    if (row.completedAt !== null) recomputeExercisePrs(se.exerciseId, tx)
  })
}

/**
 * The ghost values: every completed set of the last time this exercise was trained, in a *different*
 * session. Two round trips — find the session_exercise, then read its sets.
 *
 * Sin entradas en calor: la pantalla alinea los fantasmas por posición y las rampas no son las
 * mismas de una semana a la otra (se agregan a mano, a mitad de sesión). Contra series de trabajo
 * la posición sí significa lo mismo.
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
    .where(
      and(
        eq(setEntry.sessionExerciseId, previous.id),
        isNotNull(setEntry.completedAt),
        ne(setEntry.kind, 'warmup'),
      ),
    )
    .orderBy(asc(setEntry.orderIndex), asc(setEntry.id))
    .all()
}
